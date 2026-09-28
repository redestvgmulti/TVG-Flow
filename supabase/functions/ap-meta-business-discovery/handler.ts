import {
  authFailure,
  createAdminClient,
  json,
  metaCorsHeaders,
  requireMetaAdmin,
} from "../_shared/metaConnection.ts";
import { normalizeInstagramProfile } from "../_shared/social/instagramProfile.mjs";
import { MetaBusinessDiscoveryProvider } from "../_shared/social/metaBusinessDiscoveryProvider.ts";

const REQUIRED_RADAR_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "business_management",
];

type Connection = {
  status: string;
  instagram_user_id: string | null;
  graph_api_version: string | null;
  token_secret_ref: string | null;
  granted_scopes: string[] | null;
  capabilities: Record<string, unknown> | null;
  expires_at: string | null;
};

type Dependencies = {
  createAdminClient: typeof createAdminClient;
  requireMetaAdmin: typeof requireMetaAdmin;
  metaCorsHeaders: typeof metaCorsHeaders;
  providerFactory: typeof MetaBusinessDiscoveryProvider;
  now: () => number;
};

const defaults: Dependencies = {
  createAdminClient,
  requireMetaAdmin,
  metaCorsHeaders,
  providerFactory: MetaBusinessDiscoveryProvider,
  now: Date.now,
};

function responseError(code: string, status: number, cors: Record<string, string>) {
  return json({ error: code }, status, cors);
}

function hasRadarReadCapability(connection: Connection) {
  return connection.capabilities?.radar_read === true &&
    Array.isArray(connection.granted_scopes) &&
    REQUIRED_RADAR_SCOPES.every((scope) => connection.granted_scopes?.includes(scope));
}

function connectionExpired(connection: Connection, now: number) {
  if (!connection.expires_at) return false;
  const expiresAt = new Date(connection.expires_at).getTime();
  return Number.isNaN(expiresAt) || expiresAt <= now;
}

async function requestBody(req: Request) {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Creates the POC handler with injectable dependencies; production uses the defaults below. */
export function createMetaBusinessDiscoveryHandler(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return async (req: Request) => {
    let cors: Record<string, string>;
    try {
      cors = dependencies.metaCorsHeaders(req);
    } catch {
      return responseError("META_ORIGIN_FORBIDDEN", 403, {});
    }
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return responseError("METHOD_NOT_ALLOWED", 405, cors);

    try {
      const body = await requestBody(req);
      if (!body || typeof body.input !== "string" || "cliente_id" in body || "clienteId" in body) {
        return responseError("META_RADAR_INPUT_INVALID", 400, cors);
      }
      const rawLimit = body.limit === undefined ? 5 : body.limit;
      if (typeof rawLimit !== "number" || !Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 5) {
        return responseError("META_RADAR_LIMIT_INVALID", 400, cors);
      }
      const limit = rawLimit;
      let profile: { username: string; url: string };
      try {
        profile = normalizeInstagramProfile(body.input);
      } catch {
        return responseError("META_RADAR_INPUT_INVALID", 400, cors);
      }

      const admin = dependencies.createAdminClient();
      let actor;
      try {
        actor = await dependencies.requireMetaAdmin(req, admin);
      } catch (error) {
        return authFailure(error, cors);
      }
      const { data: connection, error: connectionError } = await admin.schema("ap")
        .from("instagram_connections")
        .select("status,instagram_user_id,instagram_username,graph_api_version,token_secret_ref,granted_scopes,capabilities,expires_at")
        .eq("cliente_id", actor.clienteId)
        .eq("provider", "meta")
        .eq("status", "connected")
        .eq("is_primary", true)
        .order("updated_at", { ascending: false })
        .maybeSingle();
      if (connectionError || !connection) return responseError("META_RADAR_CONNECTION_UNAVAILABLE", 409, cors);
      const typedConnection = connection as Connection;
      if (typedConnection.status !== "connected" || !typedConnection.instagram_user_id || !typedConnection.graph_api_version || !typedConnection.token_secret_ref) {
        return responseError("META_RADAR_CONNECTION_UNAVAILABLE", 409, cors);
      }
      if (connectionExpired(typedConnection, dependencies.now())) {
        return responseError("META_RADAR_CONNECTION_EXPIRED", 409, cors);
      }
      if (!hasRadarReadCapability(typedConnection)) {
        return responseError("META_RADAR_CAPABILITY_UNAVAILABLE", 403, cors);
      }

      const { data: pageAccessToken, error: secretError } = await admin.schema("ap").rpc("meta_read_secret", {
        p_secret_id: typedConnection.token_secret_ref,
      });
      if (secretError || typeof pageAccessToken !== "string" || !pageAccessToken) {
        return responseError("META_RADAR_SECRET_UNAVAILABLE", 503, cors);
      }
      const provider = new dependencies.providerFactory({
        graphApiVersion: typedConnection.graph_api_version,
        instagramUserId: typedConnection.instagram_user_id,
        pageAccessToken,
      });
      const [result] = await provider.collect({
        sources: [{ id: "poc", clienteId: actor.clienteId, username: profile.username, url: profile.url }],
        newerThan: { poc: null },
        limits: { maxSources: 1, maxItemsPerSource: limit, maxItemsTotal: limit, maxCalls: 1 },
      });
      if (!result || !result.complete && result.error) {
        return responseError(result?.error?.code ?? "META_BUSINESS_DISCOVERY_FAILED", 502, cors);
      }
      return json({
        provider: result.provider,
        target: {
          username: result.items[0]?.sourceUsername ?? profile.username,
          name: result.items[0]?.sourceName ?? null,
        },
        count: result.items.length,
        items: result.items,
        capability: result.capability,
        complete: result.complete,
        telemetry: { durationMs: result.telemetry.durationMs, calls: result.telemetry.calls },
      }, 200, cors);
    } catch {
      return responseError("META_BUSINESS_DISCOVERY_FAILED", 500, cors);
    }
  };
}
