import { createAdminClient } from "../_shared/metaConnection.ts";
import { requireTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import { archiveInstagramRadarImage } from "../_shared/social/instagramRadarImage.ts";
import { normalizeInstagramProfile } from "../_shared/social/instagramProfile.mjs";
import { MetaBusinessDiscoveryProvider } from "../_shared/social/metaBusinessDiscoveryProvider.ts";
import type {
  InstagramRadarCollection,
  InstagramRadarSource,
} from "../_shared/social/instagramRadarProvider.ts";

const BATCH_LIMIT = 250;
const MAX_ITEMS_PER_SOURCE = 25;
const REQUIRED_RADAR_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "business_management",
  "instagram_manage_insights",
  "ads_read",
];

type MissingImageRow = {
  id: string;
  cliente_id: string;
  source_id: string;
  metadata: {
    platform?: unknown;
    provider?: unknown;
    external_id?: unknown;
  } | null;
};

type SourceRow = {
  id: string;
  cliente_id: string;
  url: string;
};

type ConnectionRow = {
  instagram_user_id: string | null;
  graph_api_version: string | null;
  token_secret_ref: string | null;
  granted_scopes: string[] | null;
  capabilities: { radar_read?: boolean } | null;
  expires_at: string | null;
};

type Dependencies = {
  createAdminClient: typeof createAdminClient;
  requireTrustedInternalRequest: typeof requireTrustedInternalRequest;
  providerFactory: typeof MetaBusinessDiscoveryProvider;
  archiveImage: typeof archiveInstagramRadarImage;
  now: () => Date;
};

const defaults: Dependencies = {
  createAdminClient,
  requireTrustedInternalRequest,
  providerFactory: MetaBusinessDiscoveryProvider,
  archiveImage: archiveInstagramRadarImage,
  now: () => new Date(),
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validConnection(connection: ConnectionRow | null, now: Date) {
  if (
    !connection?.instagram_user_id || !connection.graph_api_version ||
    !connection.token_secret_ref ||
    connection.capabilities?.radar_read !== true ||
    !Array.isArray(connection.granted_scopes) ||
    !REQUIRED_RADAR_SCOPES.every((scope) =>
      connection.granted_scopes?.includes(scope)
    )
  ) {
    return false;
  }
  if (!connection.expires_at) return true;
  const expiry = new Date(connection.expires_at).getTime();
  return Number.isFinite(expiry) && expiry > now.getTime();
}

function groupByTenant<T extends { cliente_id: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    groups.set(row.cliente_id, [...(groups.get(row.cliente_id) ?? []), row]);
  }
  return groups;
}

/**
 * Internal-only repair for official Meta items that predate stable thumbnail
 * storage. It changes only image_url and never creates collected news.
 */
export function createInstagramRadarImageBackfillHandler(
  overrides: Partial<Dependencies> = {},
) {
  const dependencies = { ...defaults, ...overrides };
  return async (req: Request) => {
    if (req.method !== "POST") {
      return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    }
    try {
      dependencies.requireTrustedInternalRequest(req);
    } catch {
      return json({ error: "INTERNAL_WORKER_AUTH_REQUIRED" }, 401);
    }

    try {
      const admin = dependencies.createAdminClient();
      const { data: rows, error: rowsError } = await admin.schema("ap").from(
        "collected_news",
      ).select("id,cliente_id,source_id,metadata").is("image_url", null)
        .contains(
          "metadata",
          { platform: "instagram", provider: "meta_business_discovery" },
        ).limit(BATCH_LIMIT);
      if (rowsError) {
        return json({ error: "RADAR_IMAGE_BACKFILL_READ_FAILED" }, 500);
      }
      const candidates = ((rows ?? []) as MissingImageRow[]).filter((row) =>
        typeof row.metadata?.external_id === "string" &&
        row.metadata.external_id.length > 0
      );
      if (!candidates.length) {
        return json({
          ok: true,
          candidates: 0,
          updated: 0,
          unavailable: 0,
          errors: 0,
        });
      }

      const sourceIds = [...new Set(candidates.map((row) => row.source_id))];
      const { data: sourceRows, error: sourcesError } = await admin.schema("ap")
        .from(
          "sources",
        ).select("id,cliente_id,url").in("id", sourceIds).eq(
          "tipo",
          "instagram",
        );
      if (sourcesError) {
        return json({ error: "RADAR_IMAGE_BACKFILL_SOURCES_FAILED" }, 500);
      }
      const sourcesById = new Map(
        ((sourceRows ?? []) as SourceRow[]).map((
          source,
        ) => [source.id, source]),
      );

      let updated = 0;
      let unavailable = 0;
      let errors = 0;
      for (const [clienteId, tenantCandidates] of groupByTenant(candidates)) {
        const sourceCandidates = tenantCandidates.filter((candidate) =>
          sourcesById.get(candidate.source_id)?.cliente_id === clienteId
        );
        if (!sourceCandidates.length) {
          unavailable += tenantCandidates.length;
          continue;
        }
        const { data: connection, error: connectionError } = await admin.schema(
          "ap",
        ).from(
          "instagram_connections",
        ).select(
          "instagram_user_id,graph_api_version,token_secret_ref,granted_scopes,capabilities,expires_at",
        ).eq("cliente_id", clienteId).eq("provider", "meta").eq(
          "status",
          "connected",
        ).eq("is_primary", true).order("updated_at", { ascending: false })
          .maybeSingle();
        const typedConnection = connection as ConnectionRow | null;
        if (
          connectionError ||
          !validConnection(typedConnection, dependencies.now())
        ) {
          unavailable += sourceCandidates.length;
          continue;
        }
        const activeConnection = typedConnection as ConnectionRow;
        const { data: pageAccessToken, error: secretError } = await admin
          .schema("ap").rpc(
            "meta_read_secret",
            { p_secret_id: activeConnection.token_secret_ref! },
          );
        if (
          secretError || typeof pageAccessToken !== "string" || !pageAccessToken
        ) {
          unavailable += sourceCandidates.length;
          continue;
        }
        const radarSources: InstagramRadarSource[] = [];
        for (
          const sourceId of [
            ...new Set(sourceCandidates.map((row) => row.source_id)),
          ]
        ) {
          const source = sourcesById.get(sourceId);
          if (!source) continue;
          try {
            const profile = normalizeInstagramProfile(source.url);
            radarSources.push({
              id: source.id,
              clienteId,
              username: profile.username,
              url: profile.url,
            });
          } catch {
            unavailable += sourceCandidates.filter((row) =>
              row.source_id === sourceId
            ).length;
          }
        }
        if (!radarSources.length) continue;
        let collections: InstagramRadarCollection[];
        try {
          const provider = new dependencies.providerFactory({
            graphApiVersion: activeConnection.graph_api_version!,
            instagramUserId: activeConnection.instagram_user_id!,
            pageAccessToken,
          });
          collections = await provider.collect({
            sources: radarSources,
            newerThan: Object.fromEntries(
              radarSources.map((source) => [source.id, null]),
            ),
            limits: {
              maxSources: radarSources.length,
              maxItemsPerSource: MAX_ITEMS_PER_SOURCE,
              maxItemsTotal: radarSources.length * MAX_ITEMS_PER_SOURCE,
              maxCalls: radarSources.length,
            },
          });
        } catch {
          unavailable += sourceCandidates.length;
          continue;
        }
        for (const candidate of sourceCandidates) {
          const externalId = candidate.metadata!.external_id as string;
          const collection = collections.find((value) =>
            value.sourceId === candidate.source_id
          );
          const item = collection?.items.find((value) =>
            value.externalId === externalId
          );
          if (!item?.thumbnailUrl) {
            unavailable += 1;
            continue;
          }
          const imageUrl = await dependencies.archiveImage({
            storage: admin.storage,
            clienteId,
            sourceId: candidate.source_id,
            externalId,
            thumbnailUrl: item.thumbnailUrl,
          });
          if (!imageUrl) {
            errors += 1;
            continue;
          }
          const { error: updateError } = await admin.schema("ap").from(
            "collected_news",
          ).update({ image_url: imageUrl }).eq("id", candidate.id).eq(
            "cliente_id",
            clienteId,
          ).is("image_url", null);
          if (updateError) errors += 1;
          else updated += 1;
        }
      }
      return json({
        ok: true,
        candidates: candidates.length,
        updated,
        unavailable,
        errors,
      });
    } catch {
      return json({ error: "RADAR_IMAGE_BACKFILL_FAILED" }, 500);
    }
  };
}
