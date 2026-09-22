import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeConfigRequest,
  ConfigAuthorizationError,
} from "../ap-config/authorization.ts";

const corsBaseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ap-cliente-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function isExplicitDevOrTest() {
  return ["development", "dev", "test"].includes(
    (Deno.env.get("APP_ENV") || Deno.env.get("DENO_ENV") || "production").toLowerCase(),
  );
}

function configuredOrigins() {
  const configured = Deno.env.get("META_ALLOWED_ORIGINS") || Deno.env.get("FRONTEND_URL") || "";
  if (!configured && isExplicitDevOrTest()) return ["http://localhost:5173"];
  return configured.split(",").map((value) => value.trim()).filter(Boolean).flatMap((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || (isExplicitDevOrTest() && url.protocol === "http:")
        ? [url.origin]
        : [];
    } catch {
      return [];
    }
  });
}

export function metaCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const allowed = configuredOrigins();
  if (!allowed.length && !isExplicitDevOrTest()) {
    throw new Error("META_ORIGIN_FORBIDDEN");
  }
  if (!origin) return corsBaseHeaders;
  if (!allowed.includes(origin)) throw new Error("META_ORIGIN_FORBIDDEN");
  return { ...corsBaseHeaders, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

export function json(body: unknown, status = 200, cors = corsBaseHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function appRedirect(
  target: string,
  result: string,
  extra: Record<string, string> = {},
) {
  const url = new URL(
    target,
    Deno.env.get("FRONTEND_URL") || "https://invalid.local",
  );
  url.searchParams.set("meta", result);
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  return Response.redirect(url.toString(), 302);
}

export function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SERVER_CONFIGURATION_ERROR");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function requireMetaAdmin(
  req: Request,
  admin: ReturnType<typeof createAdminClient>,
) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("SERVER_CONFIGURATION_ERROR");
  return authorizeConfigRequest({
    authorization: req.headers.get("Authorization"),
    // The header is only a requested tenant. authorizeConfigRequest validates
    // it against the authenticated actor's canonical operational allow-list.
    requestedClienteId: req.headers.get("x-ap-cliente-id"),
    createUserClient: (token) =>
      createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }),
  });
}

export function authFailure(error: unknown, cors = corsBaseHeaders) {
  if (error instanceof ConfigAuthorizationError) {
    return json({ error: error.code }, error.status, cors);
  }
  return json({ error: "META_CONNECTION_FAILED" }, 500, cors);
}

export async function createVaultSecret(
  admin: ReturnType<typeof createAdminClient>,
  secret: string,
  name: string,
  description: string,
) {
  const { data, error } = await admin.schema("ap").rpc("meta_create_secret", {
    p_secret: secret,
    p_name: name,
    p_description: description,
  });
  if (error || !data) throw new Error("META_SECRET_STORE_FAILED");
  return data as string;
}

export async function deleteVaultSecret(
  admin: ReturnType<typeof createAdminClient>,
  secretId: string | null | undefined,
  { allowMissing = false }: { allowMissing?: boolean } = {},
) {
  if (!secretId) return false;
  const { data, error } = await admin.schema("ap").rpc("meta_delete_secret", {
    p_secret_id: secretId,
  });
  if (error || (data !== true && !allowMissing)) {
    throw new Error("META_SECRET_DELETE_FAILED");
  }
  return data === true;
}

/**
 * Expired selection sessions contain only temporary OAuth secrets. The active
 * connection table is never consulted or modified here. Cleanup is bounded and
 * idempotent: a secret already removed by an interrupted earlier attempt is OK.
 */
export async function cleanupExpiredMetaSelectionSessions(
  admin: ReturnType<typeof createAdminClient>,
  limit = 20,
) {
  const { error } = await admin.schema("ap").rpc("cleanup_expired_meta_oauth_sessions", {
    p_limit: limit,
  });
  if (error) throw new Error("META_SELECTION_CLEANUP_FAILED");
  // Revoked rows are never active. Retrying a bounded cleanup here is safe and
  // gives Vault outages a recovery path without adding a cron in this slice.
  const { data: pending, error: pendingError } = await admin.schema("ap")
    .from("instagram_connections")
    .select("id").in("status", ["revoked", "expired"])
    .eq("secret_cleanup_pending", true)
    .order("secret_cleanup_last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (pendingError) throw new Error("META_SELECTION_CLEANUP_FAILED");
  for (const connection of pending ?? []) {
    const { error: cleanupError } = await admin.schema("ap").rpc(
      "cleanup_revoked_meta_connection",
      { p_connection_id: connection.id },
    );
    if (cleanupError) {
      await admin.schema("ap").rpc("record_meta_secret_cleanup_failure", {
        p_connection_id: connection.id,
        p_error_code: "META_SECRET_DELETE_FAILED",
      });
    }
  }
}
