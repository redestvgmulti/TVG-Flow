import { requireTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import { createAdminClient } from "../_shared/metaConnection.ts";
import { MetaBusinessDiscoveryProvider } from "../_shared/social/metaBusinessDiscoveryProvider.ts";
import { normalizeInstagramProfile } from "../_shared/social/instagramProfile.mjs";
import type {
  InstagramRadarCollection,
  InstagramRadarItem,
  InstagramRadarSource,
} from "../_shared/social/instagramRadarProvider.ts";
import { Telemetry } from "../_shared/telemetry.ts";

export const BATCH_LIMIT = 25;
export const MAX_ITEMS_PER_SOURCE = 25;
export const MAX_AGE_HOURS = 24;
export const PARSER_VERSION = "instagram-meta-v1";

const REQUIRED_RADAR_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "business_management",
  "instagram_manage_insights",
  "ads_read",
];

type Source = {
  id: string;
  cliente_id: string;
  nome: string | null;
  url: string;
  tipo: string;
  consecutive_failures: number | null;
};

type Connection = {
  instagram_user_id: string | null;
  graph_api_version: string | null;
  token_secret_ref: string | null;
  granted_scopes: string[] | null;
  capabilities: Record<string, unknown> | null;
  expires_at: string | null;
};

type Provider = {
  collect(options: {
    sources: InstagramRadarSource[];
    newerThan: Record<string, string | null>;
    limits: {
      maxSources: number;
      maxItemsPerSource: number;
      maxItemsTotal: number;
      maxCalls: number;
    };
  }): Promise<InstagramRadarCollection[]>;
};

type Dependencies = {
  createAdminClient: typeof createAdminClient;
  requireTrustedInternalRequest: typeof requireTrustedInternalRequest;
  providerFactory: typeof MetaBusinessDiscoveryProvider;
  telemetryFactory: typeof Telemetry;
  now: () => Date;
};

const defaults: Dependencies = {
  createAdminClient,
  requireTrustedInternalRequest,
  providerFactory: MetaBusinessDiscoveryProvider,
  telemetryFactory: Telemetry,
  now: () => new Date(),
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function hasRadarReadCapability(connection: Connection) {
  return connection.capabilities?.radar_read === true &&
    Array.isArray(connection.granted_scopes) &&
    REQUIRED_RADAR_SCOPES.every((scope) =>
      connection.granted_scopes?.includes(scope)
    );
}

function connectionExpired(connection: Connection, now: Date) {
  if (!connection.expires_at) return false;
  const timestamp = new Date(connection.expires_at).getTime();
  return Number.isNaN(timestamp) || timestamp <= now.getTime();
}

function text(value: string | null | undefined, max: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Deterministic editorial fields only; no generated headline is used. */
export function instagramTitle(item: InstagramRadarItem) {
  const firstLine = item.caption.split(/\r?\n/).find((line) => line.trim()) ??
    "";
  const title = text(firstLine, 180);
  return title.length >= 3 ? title : `Publicação de @${item.sourceUsername}`;
}

export function instagramExcerpt(item: InstagramRadarItem) {
  const excerpt = text(item.caption, 500);
  return excerpt || null;
}

export async function instagramContentHash(item: InstagramRadarItem) {
  const input = [
    item.externalId,
    item.canonicalUrl,
    item.caption,
    item.publishedAt,
    item.mediaType,
  ].join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function groupByTenant(sources: Source[]) {
  const groups = new Map<string, Source[]>();
  for (const source of sources) {
    groups.set(source.cliente_id, [
      ...(groups.get(source.cliente_id) ?? []),
      source,
    ]);
  }
  return groups;
}

async function updateSource(
  admin: any,
  source: Source,
  update: Record<string, unknown>,
) {
  await admin.schema("ap").from("sources").update(update).eq("id", source.id)
    .eq("cliente_id", source.cliente_id);
}

async function insertRun(admin: any, values: Record<string, unknown>) {
  await admin.schema("ap").from("source_ingestion_runs").insert(values);
}

function resultFor(source: Source, values: Record<string, unknown>) {
  return { source_id: source.id, ...values };
}

async function recordSourceError(
  admin: any,
  source: Source,
  workerId: string,
  startedAt: string,
  code: string,
  metadata: Record<string, unknown>,
  now: Date,
) {
  await updateSource(admin, source, {
    last_checked_at: now.toISOString(),
    last_error_code: code,
    consecutive_failures: Number(source.consecutive_failures ?? 0) + 1,
    last_discovered_count: 0,
    last_collected_count: 0,
  });
  await insertRun(admin, {
    source_id: source.id,
    cliente_id: source.cliente_id,
    worker_id: workerId,
    detected_type: "instagram",
    status: "error",
    discovered_count: 0,
    collected_count: 0,
    skipped_old_count: 0,
    error_count: 1,
    error_code: code,
    started_at: startedAt,
    finished_at: now.toISOString(),
    metadata: {
      correlation_id: workerId,
      provider: "meta_business_discovery",
      mode: "instagram_radar",
      ...metadata,
    },
  });
}

/**
 * Internal-only ingestion worker. It has no browser CORS surface and uses the
 * canonical RPC for all collected-news persistence.
 */
export function createInstagramRadarIngestionHandler(
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
    }
    const admin = dependencies.createAdminClient();
    const workerId = crypto.randomUUID();
    const startedAt = dependencies.now();
    const cutoffMs = startedAt.getTime() - MAX_AGE_HOURS * 60 * 60 * 1000;
    const runTelemetry = new dependencies.telemetryFactory(admin as never);
    await runTelemetry.logStart({
      worker_name: "ap-instagram-radar-ingestion",
      worker_id: workerId,
      action: "internal_batch",
      metadata: { mode: "instagram_radar", parser_version: PARSER_VERSION },
    });

    const { data: disabledConfigs, error: configError } = await admin.schema(
      "ap",
    ).from("system_config")
      .select("cliente_id").eq("ingestion_enabled", false);
    if (configError) {
      await runTelemetry.logError("FETCH_SYSTEM_CONFIG_FAILED", 0, {
        mode: "instagram_radar",
      });
      return json({ error: "FETCH_SYSTEM_CONFIG_FAILED" }, 500);
    }
    const disabledIds = (disabledConfigs ?? []).map((
      row: { cliente_id: string },
    ) => row.cliente_id);
    let sourceQuery: any = admin.schema("ap").from("sources")
      .select(
        "id,cliente_id,nome,url,tipo,consecutive_failures,last_checked_at,created_at",
      )
      .eq("tipo", "instagram").eq("ativo", true)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    if (disabledIds.length) {
      sourceQuery = sourceQuery.not(
        "cliente_id",
        "in",
        `(${disabledIds.join(",")})`,
      );
    }
    const { data: rawSources, error: sourceError } = await sourceQuery.limit(
      BATCH_LIMIT,
    );
    if (sourceError) {
      await runTelemetry.logError("FETCH_SOURCES_FAILED", 0, {
        mode: "instagram_radar",
      });
      return json({ error: "FETCH_SOURCES_FAILED" }, 500);
    }
    const sources = (rawSources ?? []) as Source[];
    const results: Array<Record<string, unknown>> = [];
    const sourceTelemetry = new Map<string, InstanceType<typeof Telemetry>>();
    for (const source of sources) {
      const telemetry = new dependencies.telemetryFactory(admin as never);
      sourceTelemetry.set(source.id, telemetry);
      await telemetry.logStart({
        worker_name: "ap-instagram-radar-ingestion",
        worker_id: workerId,
        cliente_id: source.cliente_id,
        action: "internal_batch",
        metadata: {
          source_id: source.id,
          mode: "instagram_radar",
          provider: "meta_business_discovery",
        },
      });
    }

    for (const [clienteId, tenantSources] of groupByTenant(sources)) {
      const sourceStartedAt = startedAt.toISOString();
      const { data: connection, error: connectionError } = await admin.schema(
        "ap",
      ).from("instagram_connections")
        .select(
          "instagram_user_id,graph_api_version,token_secret_ref,granted_scopes,capabilities,expires_at",
        )
        .eq("cliente_id", clienteId).eq("provider", "meta").eq(
          "status",
          "connected",
        ).eq("is_primary", true)
        .order("updated_at", { ascending: false }).maybeSingle();
      const typedConnection = connection as Connection | null;
      let tenantError: string | null = connectionError || !typedConnection ||
          !typedConnection.instagram_user_id ||
          !typedConnection.graph_api_version ||
          !typedConnection.token_secret_ref ||
          connectionExpired(typedConnection, startedAt)
        ? "META_RADAR_CONNECTION_UNAVAILABLE"
        : !hasRadarReadCapability(typedConnection)
        ? "META_RADAR_CAPABILITY_UNAVAILABLE"
        : null;
      let pageAccessToken: string | null = null;
      if (!tenantError) {
        const secret = await admin.schema("ap").rpc("meta_read_secret", {
          p_secret_id: typedConnection!.token_secret_ref,
        });
        if (secret.error || typeof secret.data !== "string" || !secret.data) {
          tenantError = "META_RADAR_SECRET_UNAVAILABLE";
        } else pageAccessToken = secret.data;
      }
      if (tenantError) {
        for (const source of tenantSources) {
          await recordSourceError(
            admin,
            source,
            workerId,
            sourceStartedAt,
            tenantError,
            { calls: 0, complete: false },
            dependencies.now(),
          );
          await sourceTelemetry.get(source.id)?.logError(tenantError, 0, {
            mode: "instagram_radar",
            source_id: source.id,
            calls: 0,
          });
          results.push(
            resultFor(source, {
              discovered: 0,
              valid: 0,
              collected: 0,
              duplicates: 0,
              skipped_old: 0,
              errors: 1,
              complete: false,
              error_code: tenantError,
            }),
          );
        }
        continue;
      }

      const radarSources: InstagramRadarSource[] = [];
      for (const source of tenantSources) {
        try {
          const profile = normalizeInstagramProfile(source.url);
          radarSources.push({
            id: source.id,
            clienteId,
            username: profile.username,
            url: profile.url,
          });
        } catch {
          await recordSourceError(
            admin,
            source,
            workerId,
            sourceStartedAt,
            "META_RADAR_SOURCE_INVALID",
            { calls: 0, complete: false },
            dependencies.now(),
          );
          await sourceTelemetry.get(source.id)?.logError(
            "META_RADAR_SOURCE_INVALID",
            0,
            { mode: "instagram_radar", source_id: source.id, calls: 0 },
          );
          results.push(
            resultFor(source, {
              discovered: 0,
              valid: 0,
              collected: 0,
              duplicates: 0,
              skipped_old: 0,
              errors: 1,
              complete: false,
              error_code: "META_RADAR_SOURCE_INVALID",
            }),
          );
        }
      }
      if (!radarSources.length) continue;
      const provider: Provider = new dependencies.providerFactory({
        graphApiVersion: typedConnection!.graph_api_version!,
        instagramUserId: typedConnection!.instagram_user_id!,
        pageAccessToken: pageAccessToken!,
      });
      let collections: InstagramRadarCollection[];
      try {
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
        collections = radarSources.map((source) => ({
          sourceId: source.id,
          provider: "meta_business_discovery",
          items: [],
          capability: "unknown",
          complete: false,
          error: { code: "META_BUSINESS_DISCOVERY_FAILED", retryable: true },
          telemetry: {
            durationMs: 0,
            calls: 0,
            billedResults: null,
            costUsd: null,
          },
        }));
      }
      for (
        const source of tenantSources.filter((value) =>
          radarSources.some((radar) => radar.id === value.id)
        )
      ) {
        const now = dependencies.now();
        const collection = collections.find((value) =>
          value.sourceId === source.id
        );
        if (!collection || collection.error) {
          const code = collection?.error?.code ??
            "META_BUSINESS_DISCOVERY_FAILED";
          await recordSourceError(
            admin,
            source,
            workerId,
            sourceStartedAt,
            code,
            {
              calls: collection?.telemetry.calls ?? 0,
              complete: collection?.complete ?? false,
            },
            now,
          );
          await sourceTelemetry.get(source.id)?.logError(code, 0, {
            mode: "instagram_radar",
            source_id: source.id,
            calls: collection?.telemetry.calls ?? 0,
          });
          results.push(
            resultFor(source, {
              discovered: 0,
              valid: 0,
              collected: 0,
              duplicates: 0,
              skipped_old: 0,
              errors: 1,
              complete: collection?.complete ?? false,
              error_code: code,
            }),
          );
          continue;
        }
        const sourceStartedMs = performance.now();
        let valid = 0;
        let collected = 0;
        let duplicates = 0;
        let skippedOld = 0;
        let errors = 0;
        for (const item of collection.items) {
          const publishedAt = new Date(item.publishedAt).getTime();
          if (!Number.isFinite(publishedAt) || publishedAt < cutoffMs) {
            skippedOld += 1;
            continue;
          }
          valid += 1;
          try {
            const { data, error } = await admin.schema("ap").rpc(
              "ingest_collected_news",
              {
                p_cliente_id: source.cliente_id,
                p_source_id: source.id,
                p_url_original: item.canonicalUrl,
                p_canonical_url: item.canonicalUrl,
                p_title: instagramTitle(item),
                p_excerpt: instagramExcerpt(item),
                p_content: item.caption || null,
                p_image_url: item.thumbnailUrl,
                p_published_at: item.publishedAt,
                p_content_hash: await instagramContentHash(item),
                p_parser_version: PARSER_VERSION,
                p_metadata: {
                  platform: "instagram",
                  provider: "meta_business_discovery",
                  external_id: item.externalId,
                  media_type: item.mediaType,
                  source_username: item.sourceUsername,
                  source_name: item.sourceName,
                  discovery_complete: collection.complete,
                  parser_version: PARSER_VERSION,
                },
              },
            );
            if (error) throw error;
            if (data?.created === true) collected += 1;
            else duplicates += 1;
          } catch {
            errors += 1;
          }
        }
        const errorCode = errors ? "ITEM_PERSIST_FAILED" : null;
        await updateSource(admin, source, {
          detected_type: "instagram",
          last_checked_at: now.toISOString(),
          last_success_at: now.toISOString(),
          last_error_code: errorCode,
          consecutive_failures: 0,
          last_discovered_count: collection.items.length,
          last_collected_count: collected,
        });
        const status = errors ? "completed_with_errors" : "success";
        await insertRun(admin, {
          source_id: source.id,
          cliente_id: source.cliente_id,
          worker_id: workerId,
          detected_type: "instagram",
          status,
          discovered_count: collection.items.length,
          collected_count: collected,
          skipped_old_count: skippedOld,
          error_count: errors,
          error_code: errorCode,
          started_at: sourceStartedAt,
          finished_at: now.toISOString(),
          metadata: {
            correlation_id: workerId,
            provider: "meta_business_discovery",
            mode: "instagram_radar",
            complete: collection.complete,
            duplicate_count: duplicates,
            valid_count: valid,
            duration_ms: Math.round(performance.now() - sourceStartedMs),
            calls: collection.telemetry.calls,
          },
        });
        await sourceTelemetry.get(source.id)?.logSuccess(0, {
          mode: "instagram_radar",
          source_id: source.id,
          discovered: collection.items.length,
          valid,
          collected,
          duplicates,
          skipped_old: skippedOld,
          errors,
          complete: collection.complete,
          calls: collection.telemetry.calls,
        });
        results.push(
          resultFor(source, {
            discovered: collection.items.length,
            valid,
            collected,
            duplicates,
            skipped_old: skippedOld,
            errors,
            complete: collection.complete,
            error_code: errorCode,
          }),
        );
      }
    }
    const totalErrors = results.reduce(
      (sum, result) => sum + Number(result.errors ?? 0),
      0,
    );
    await runTelemetry.logSuccess(0, {
      mode: "instagram_radar",
      result: totalErrors ? "completed_with_errors" : "success",
      sources: results.length,
      collected: results.reduce(
        (sum, result) => sum + Number(result.collected ?? 0),
        0,
      ),
      errors: totalErrors,
    });
    return json({
      ok: true,
      destination: "ap.collected_news",
      mode: "instagram_radar",
      max_age_hours: MAX_AGE_HOURS,
      results,
    });
  };
}
