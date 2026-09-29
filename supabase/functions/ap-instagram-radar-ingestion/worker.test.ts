import { assert, assertEquals, assertMatch } from "jsr:@std/assert";
import type {
  InstagramRadarCollection,
  InstagramRadarItem,
} from "../_shared/social/instagramRadarProvider.ts";
import {
  BATCH_LIMIT,
  createInstagramRadarIngestionHandler,
  hasRadarReadCapability,
  instagramContentHash,
  instagramExcerpt,
  instagramTitle,
  MAX_AGE_HOURS,
  MAX_ITEMS_PER_SOURCE,
  PARSER_VERSION,
} from "./worker.ts";
import {
  type RadarCollectedNewsInput,
  type RadarCollectedNewsResult,
  type RadarConnection,
  type RadarIngestionRunInput,
  type RadarIngestionStore,
  RadarIngestionStoreError,
  type RadarSource,
  type RadarSourceStateUpdate,
} from "./store.ts";

const scopes = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "business_management",
  "instagram_manage_insights",
  "ads_read",
];
const source: RadarSource = {
  id: "source-a",
  cliente_id: "tenant-a",
  nome: "@prefeitura",
  url: "https://www.instagram.com/prefeitura/",
  tipo: "instagram",
  consecutive_failures: 0,
};
const connection: RadarConnection = {
  instagram_user_id: "caller",
  graph_api_version: "v26.0",
  token_secret_ref: "vault-ref",
  granted_scopes: scopes,
  capabilities: { radar_read: true },
  expires_at: null,
};
function item(overrides: Partial<InstagramRadarItem> = {}): InstagramRadarItem {
  return {
    externalId: "meta-media-id",
    canonicalUrl: "https://www.instagram.com/p/example/",
    sourceUsername: "prefeitura",
    sourceName: "Prefeitura",
    caption: "Primeira linha\nSegunda linha",
    publishedAt: "2026-09-28T12:00:00.000Z",
    thumbnailUrl: "https://cdn.example/image.jpg",
    mediaType: "feed",
    ...overrides,
  };
}

class FakeRadarIngestionStore implements RadarIngestionStore {
  disabledTenantLoads = 0;
  sourceLoads: Array<{ disabledTenantIds: string[]; limit: number }> = [];
  connectionLoads: string[] = [];
  secretReads: string[] = [];
  ingestCalls: RadarCollectedNewsInput[] = [];
  sourceUpdates: Array<
    { sourceId: string; clienteId: string; update: RadarSourceStateUpdate }
  > = [];
  runInserts: RadarIngestionRunInput[] = [];
  constructor(
    private readonly options: {
      updateError?: boolean;
      insertError?: boolean;
      created?: boolean;
    } = {},
  ) {}
  async loadDisabledTenantIds() {
    this.disabledTenantLoads++;
    return [];
  }
  async loadInstagramSources(disabledTenantIds: string[], limit: number) {
    this.sourceLoads.push({ disabledTenantIds, limit });
    return [source];
  }
  async loadPrimaryMetaConnection(clienteId: string) {
    this.connectionLoads.push(clienteId);
    return connection;
  }
  async readMetaSecret(secretRef: string) {
    this.secretReads.push(secretRef);
    return "page-token";
  }
  async ingestCollectedNews(
    input: RadarCollectedNewsInput,
  ): Promise<RadarCollectedNewsResult> {
    this.ingestCalls.push(input);
    return { created: this.options.created ?? true };
  }
  async updateSourceState(
    sourceId: string,
    clienteId: string,
    update: RadarSourceStateUpdate,
  ) {
    this.sourceUpdates.push({ sourceId, clienteId, update });
    if (this.options.updateError) {
      throw new RadarIngestionStoreError("RADAR_SOURCE_STATE_WRITE_FAILED");
    }
  }
  async insertIngestionRun(run: RadarIngestionRunInput) {
    this.runInserts.push(run);
    if (this.options.insertError) {
      throw new RadarIngestionStoreError("RADAR_INGESTION_RUN_WRITE_FAILED");
    }
  }
}

function harness(
  options: { updateError?: boolean; insertError?: boolean; created?: boolean } =
    {},
) {
  const store = new FakeRadarIngestionStore(options);
  class Provider {
    constructor(_options: unknown) {}
    async collect() {
      return [{
        sourceId: source.id,
        provider: "meta_business_discovery" as const,
        capability: "supported" as const,
        complete: false,
        items: [item()],
        telemetry: {
          durationMs: 1,
          calls: 1,
          billedResults: null,
          costUsd: null,
        },
      }];
    }
  }
  class Telemetry {
    constructor(_admin: unknown) {}
    async logStart(_v: unknown) {}
    async logSuccess(_c: number, _v: unknown) {}
    async logError(_e: string, _c: number, _v: unknown) {}
  }
  return {
    store,
    handler: createInstagramRadarIngestionHandler({
      createAdminClient: () => ({}) as never,
      storeFactory: () => store,
      requireTrustedInternalRequest: () => {},
      providerFactory: Provider as never,
      telemetryFactory: Telemetry as never,
      now: () => new Date("2026-09-28T12:00:00Z"),
    }),
  };
}

async function withEnv(run: () => Promise<void>) {
  const url = Deno.env.get("SUPABASE_URL"),
    key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  try {
    await run();
  } finally {
    if (url) Deno.env.set("SUPABASE_URL", url);
    else Deno.env.delete("SUPABASE_URL");
    if (key) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key);
    else Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
}

async function withInternalWorkerSecret(
  secret: string | null,
  run: () => Promise<void>,
) {
  const previous = Deno.env.get("AP_INTERNAL_WORKER_SECRET");
  if (secret === null) Deno.env.delete("AP_INTERNAL_WORKER_SECRET");
  else Deno.env.set("AP_INTERNAL_WORKER_SECRET", secret);
  try {
    await run();
  } finally {
    if (previous === undefined) Deno.env.delete("AP_INTERNAL_WORKER_SECRET");
    else Deno.env.set("AP_INTERNAL_WORKER_SECRET", previous);
  }
}

type AdvancedOptions = {
  sources?: RadarSource[];
  disabledTenantIds?: string[];
  connections?: Record<string, RadarConnection | null>;
  secrets?: Record<string, string | null>;
  collections?: Record<string, InstagramRadarCollection>;
  ingest?: Array<boolean | Error>;
  updateError?: boolean;
  insertError?: boolean;
};

class AdvancedFakeStore implements RadarIngestionStore {
  readonly connectionLoads: string[] = [];
  readonly secretReads: string[] = [];
  readonly ingestCalls: RadarCollectedNewsInput[] = [];
  readonly sourceUpdates: Array<{
    sourceId: string;
    clienteId: string;
    update: RadarSourceStateUpdate;
  }> = [];
  readonly runInserts: RadarIngestionRunInput[] = [];

  constructor(readonly options: AdvancedOptions) {}
  async loadDisabledTenantIds() {
    return this.options.disabledTenantIds ?? [];
  }
  async loadInstagramSources(disabled: string[], _limit: number) {
    return (this.options.sources ?? []).filter((value) =>
      !disabled.includes(value.cliente_id)
    );
  }
  async loadPrimaryMetaConnection(clienteId: string) {
    this.connectionLoads.push(clienteId);
    return this.options.connections?.[clienteId] ?? connection;
  }
  async readMetaSecret(ref: string) {
    this.secretReads.push(ref);
    return this.options.secrets && ref in this.options.secrets
      ? this.options.secrets[ref]
      : "page-token";
  }
  async ingestCollectedNews(input: RadarCollectedNewsInput) {
    this.ingestCalls.push(input);
    const result = this.options.ingest?.[this.ingestCalls.length - 1] ?? true;
    if (result instanceof Error) throw result;
    return { created: result };
  }
  async updateSourceState(
    sourceId: string,
    clienteId: string,
    update: RadarSourceStateUpdate,
  ) {
    this.sourceUpdates.push({ sourceId, clienteId, update });
    if (this.options.updateError) {
      throw new RadarIngestionStoreError("RADAR_SOURCE_STATE_WRITE_FAILED");
    }
  }
  async insertIngestionRun(run: RadarIngestionRunInput) {
    this.runInserts.push(run);
    if (this.options.insertError) {
      throw new RadarIngestionStoreError("RADAR_INGESTION_RUN_WRITE_FAILED");
    }
  }
}

function collection(
  sourceId: string,
  options: Partial<InstagramRadarCollection> = {},
): InstagramRadarCollection {
  return {
    sourceId,
    provider: "meta_business_discovery",
    capability: "supported",
    complete: true,
    items: [item()],
    telemetry: { durationMs: 7, calls: 1, billedResults: null, costUsd: null },
    ...options,
  };
}

function advancedHarness(options: AdvancedOptions) {
  const store = new AdvancedFakeStore(options);
  const providerOptions: Array<{
    graphApiVersion: string;
    instagramUserId: string;
    pageAccessToken: string;
  }> = [];
  const collectCalls: Array<{ sources: { id: string }[] }> = [];
  const telemetry: unknown[] = [];
  class Provider {
    constructor(input: {
      graphApiVersion: string;
      instagramUserId: string;
      pageAccessToken: string;
    }) {
      providerOptions.push(input);
    }
    async collect(input: { sources: { id: string }[] }) {
      collectCalls.push(input);
      return input.sources.map((value) =>
        options.collections?.[value.id] ?? collection(value.id)
      );
    }
  }
  class CapturingTelemetry {
    constructor(_admin: unknown) {}
    async logStart(value: unknown) {
      telemetry.push(value);
    }
    async logSuccess(_cost: number, value: unknown) {
      telemetry.push(value);
    }
    async logError(_code: string, _cost: number, value: unknown) {
      telemetry.push(value);
    }
  }
  return {
    store,
    providerOptions,
    collectCalls,
    telemetry,
    handler: createInstagramRadarIngestionHandler({
      createAdminClient: () => ({}) as never,
      storeFactory: () => store,
      requireTrustedInternalRequest: () => {},
      providerFactory: Provider as never,
      telemetryFactory: CapturingTelemetry as never,
      now: () => new Date("2026-09-28T12:00:00Z"),
    }),
  };
}

async function runAdvanced(options: AdvancedOptions) {
  const test = advancedHarness(options);
  let response!: Response;
  await withEnv(async () => {
    response = await test.handler(
      new Request("https://worker.test", { method: "POST" }),
    );
  });
  return { ...test, response, body: await response.json() };
}

function authBoundaryHarness() {
  const store = new AdvancedFakeStore({ sources: [] });
  const sideEffects = { admin: 0, store: 0, telemetry: 0 };
  class Provider {
    constructor(_options: unknown) {}
    async collect() {
      return [];
    }
  }
  class Telemetry {
    constructor(_admin: unknown) {
      sideEffects.telemetry += 1;
    }
    async logStart(_value: unknown) {}
    async logSuccess(_cost: number, _value: unknown) {}
    async logError(_code: string, _cost: number, _value: unknown) {}
  }
  return {
    sideEffects,
    handler: createInstagramRadarIngestionHandler({
      createAdminClient: () => {
        sideEffects.admin += 1;
        return {} as never;
      },
      storeFactory: () => {
        sideEffects.store += 1;
        return store;
      },
      providerFactory: Provider as never,
      telemetryFactory: Telemetry as never,
      now: () => new Date("2026-09-28T12:00:00Z"),
    }),
  };
}

Deno.test("Internal worker auth rejects a POST without the header before dependencies", async () => {
  await withEnv(async () => {
    await withInternalWorkerSecret(crypto.randomUUID(), async () => {
      const test = authBoundaryHarness();
      const response = await test.handler(
        new Request("https://worker.test", { method: "POST" }),
      );
      assertEquals(response.status, 401);
      assertEquals(
        await response.json(),
        { error: "INTERNAL_WORKER_AUTH_REQUIRED" },
      );
      assertEquals(test.sideEffects, { admin: 0, store: 0, telemetry: 0 });
    });
  });
});

Deno.test("Internal worker auth rejects an incorrect header before dependencies", async () => {
  await withEnv(async () => {
    await withInternalWorkerSecret(crypto.randomUUID(), async () => {
      const test = authBoundaryHarness();
      const response = await test.handler(
        new Request("https://worker.test", {
          method: "POST",
          headers: { "x-ap-internal-secret": crypto.randomUUID() },
        }),
      );
      assertEquals(response.status, 401);
      assertEquals(
        await response.json(),
        { error: "INTERNAL_WORKER_AUTH_REQUIRED" },
      );
      assertEquals(test.sideEffects, { admin: 0, store: 0, telemetry: 0 });
    });
  });
});

Deno.test("Internal worker auth rejects when its environment secret is absent", async () => {
  await withEnv(async () => {
    await withInternalWorkerSecret(null, async () => {
      const test = authBoundaryHarness();
      const response = await test.handler(
        new Request("https://worker.test", {
          method: "POST",
          headers: { "x-ap-internal-secret": crypto.randomUUID() },
        }),
      );
      assertEquals(response.status, 401);
      assertEquals(
        await response.json(),
        { error: "INTERNAL_WORKER_AUTH_REQUIRED" },
      );
      assertEquals(test.sideEffects, { admin: 0, store: 0, telemetry: 0 });
    });
  });
});

Deno.test("Internal worker auth accepts the configured secret and enters normal handling", async () => {
  await withEnv(async () => {
    const secret = crypto.randomUUID();
    await withInternalWorkerSecret(secret, async () => {
      const test = authBoundaryHarness();
      const response = await test.handler(
        new Request("https://worker.test", {
          method: "POST",
          headers: { "x-ap-internal-secret": secret },
        }),
      );
      assertEquals(response.status, 200);
      assertEquals((await response.json()).ok, true);
      assertEquals(test.sideEffects.admin, 1);
      assertEquals(test.sideEffects.store, 1);
    });
  });
});

Deno.test("Internal worker auth preserves POST-only behavior before dependencies", async () => {
  await withEnv(async () => {
    const secret = crypto.randomUUID();
    await withInternalWorkerSecret(secret, async () => {
      const test = authBoundaryHarness();
      const response = await test.handler(
        new Request("https://worker.test", {
          method: "GET",
          headers: { "x-ap-internal-secret": secret },
        }),
      );
      assertEquals(response.status, 405);
      assertEquals(await response.json(), { error: "METHOD_NOT_ALLOWED" });
      assertEquals(test.sideEffects, { admin: 0, store: 0, telemetry: 0 });
    });
  });
});

Deno.test("Radar worker uses the six-scope capability fail-closed contract", () => {
  assert(hasRadarReadCapability(connection));
  assert(
    !hasRadarReadCapability({
      ...connection,
      granted_scopes: scopes.slice(0, -1),
    }),
  );
  assert(
    !hasRadarReadCapability({
      ...connection,
      capabilities: { radar_read: false },
    }),
  );
});

Deno.test("Instagram editorial mapping is deterministic", async () => {
  assertEquals(instagramTitle(item()), "Primeira linha");
  assertEquals(
    instagramTitle(item({ caption: "  \n " })),
    "Publica\u00e7\u00e3o de @prefeitura",
  );
  assertEquals(
    instagramExcerpt(item({ caption: "  A   legenda\ncom espa\u00e7os  " })),
    "A legenda com espa\u00e7os",
  );
  assertEquals(instagramExcerpt(item({ caption: "" })), null);
  assertEquals(
    await instagramContentHash(item()),
    await instagramContentHash(item()),
  );
  assert(
    (await instagramContentHash(item())) !==
      (await instagramContentHash(item({ externalId: "other" }))),
  );
});

Deno.test("Worker delegates all Radar domain I/O to the store", async () => {
  const worker = await Deno.readTextFile(
    new URL("./worker.ts", import.meta.url),
  );
  const store = await Deno.readTextFile(new URL("./store.ts", import.meta.url));
  assertEquals(BATCH_LIMIT, 25);
  assertEquals(MAX_ITEMS_PER_SOURCE, 25);
  assertEquals(MAX_AGE_HOURS, 24);
  assertEquals(PARSER_VERSION, "instagram-meta-v1");
  for (
    const forbidden of [
      'from("sources")',
      'from("instagram_connections")',
      'from("source_ingestion_runs")',
      'rpc("meta_read_secret")',
      'rpc("ingest_collected_news")',
    ]
  ) assert(!worker.includes(forbidden));
  assertMatch(store, /\.eq\("tipo", "instagram"\)\.eq\("ativo", true\)/);
  assertMatch(store, /\.order\("last_checked_at", \{/);
  assertMatch(store, /\.order\("created_at", \{ ascending: true \}\)/);
  assertMatch(store, /"ingest_collected_news"/);
  assertMatch(worker, /complete: collection\.complete/);
  assertMatch(worker, /publishedAt < cutoffMs/);
  assert(!worker.includes("Apify"));
  assert(!worker.includes("access_token"));
});

Deno.test("Worker response and run metadata omit sensitive provider data", async () => {
  const worker = await Deno.readTextFile(
    new URL("./worker.ts", import.meta.url),
  );
  const response = worker.slice(worker.lastIndexOf("return json({ ok: true"));
  assert(!response.includes("caption"));
  assert(!response.includes("token_secret_ref"));
  assert(!response.includes("paging"));
  assertMatch(worker, /provider: "meta_business_discovery"/);
  assertMatch(worker, /external_id: item\.externalId/);
  assertMatch(worker, /discovery_complete: collection\.complete/);
});

Deno.test("Worker orchestrates a recent item through a successful incomplete collection", async () =>
  await withEnv(async () => {
    const test = harness();
    const response = await test.handler(
      new Request("https://worker.test", { method: "POST" }),
    );
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.ok, true);
    assertEquals(body.results[0].collected, 1);
    assertEquals(body.results[0].complete, false);
    assertEquals(test.store.runInserts[0].status, "success");
    assertEquals(test.store.ingestCalls.length, 1);
  }));

Deno.test("Worker turns a source-state write failure into a sanitized 500", async () =>
  await withEnv(async () => {
    const response = await harness({ updateError: true }).handler(
      new Request("https://worker.test", { method: "POST" }),
    );
    assertEquals(response.status, 500);
    assertEquals(
      (await response.json()).error,
      "RADAR_SOURCE_STATE_WRITE_FAILED",
    );
  }));

Deno.test("Worker turns an ingestion-run write failure into a sanitized 500", async () =>
  await withEnv(async () => {
    const response = await harness({ insertError: true }).handler(
      new Request("https://worker.test", { method: "POST" }),
    );
    assertEquals(response.status, 500);
    assertEquals(
      (await response.json()).error,
      "RADAR_INGESTION_RUN_WRITE_FAILED",
    );
  }));

Deno.test("A/Q/R success writes exact source state and safe run", async () => {
  const test = await runAdvanced({ sources: [source] });
  assertEquals(test.response.status, 200);
  assertEquals(test.body.ok, true);
  assertEquals(test.body.results[0], {
    source_id: source.id,
    discovered: 1,
    valid: 1,
    collected: 1,
    duplicates: 0,
    skipped_old: 0,
    errors: 0,
    complete: true,
    error_code: null,
  });
  assertEquals(test.store.sourceUpdates[0].update, {
    detected_type: "instagram",
    last_checked_at: "2026-09-28T12:00:00.000Z",
    last_success_at: "2026-09-28T12:00:00.000Z",
    last_error_code: null,
    consecutive_failures: 0,
    last_discovered_count: 1,
    last_collected_count: 1,
  });
  const run = test.store.runInserts[0];
  assertEquals(run.source_id, source.id);
  assertEquals(run.cliente_id, source.cliente_id);
  assertEquals(run.detected_type, "instagram");
  assertEquals(run.status, "success");
  assertEquals(run.discovered_count, 1);
  assertEquals(run.collected_count, 1);
  assertEquals(run.skipped_old_count, 0);
  assertEquals(run.error_count, 0);
  assertEquals(run.error_code, null);
  assertEquals(run.started_at, "2026-09-28T12:00:00.000Z");
  assertEquals(run.finished_at, "2026-09-28T12:00:00.000Z");
  assertEquals(run.metadata.correlation_id, run.worker_id);
  assertEquals(run.metadata.provider, "meta_business_discovery");
  assertEquals(run.metadata.mode, "instagram_radar");
  assertEquals(run.metadata.complete, true);
  assertEquals(run.metadata.duplicate_count, 0);
  assertEquals(run.metadata.valid_count, 1);
  assertEquals(run.metadata.calls, 1);
  assert(typeof run.metadata.duration_ms === "number");
});

Deno.test("B/C/I deduplication, old rolling-window items and incomplete pages remain successful", async () => {
  const dedup = await runAdvanced({
    sources: [source],
    ingest: [false],
    collections: { [source.id]: collection(source.id, { complete: false }) },
  });
  assertEquals(dedup.body.results[0].collected, 0);
  assertEquals(dedup.body.results[0].duplicates, 1);
  assertEquals(dedup.store.runInserts[0].status, "success");
  assertEquals(dedup.store.runInserts[0].metadata.complete, false);
  assertEquals(dedup.store.sourceUpdates[0].update.consecutive_failures, 0);
  const old = await runAdvanced({
    sources: [source],
    collections: {
      [source.id]: collection(source.id, {
        items: [item({ publishedAt: "2026-09-27T11:59:59.000Z" })],
      }),
    },
  });
  assertEquals(old.store.ingestCalls.length, 0);
  assertEquals(old.body.results[0].valid, 0);
  assertEquals(old.body.results[0].skipped_old, 1);
  assertEquals(old.store.runInserts[0].status, "success");
});

Deno.test("D provider error increments source failure and records error run", async () => {
  const test = await runAdvanced({
    sources: [{ ...source, consecutive_failures: 2 }],
    collections: {
      [source.id]: collection(source.id, {
        items: [],
        complete: false,
        error: {
          code: "META_BUSINESS_DISCOVERY_RATE_LIMITED",
          retryable: true,
        },
      }),
    },
  });
  assertEquals(test.store.ingestCalls.length, 0);
  assertEquals(
    test.store.sourceUpdates[0].update.last_error_code,
    "META_BUSINESS_DISCOVERY_RATE_LIMITED",
  );
  assertEquals(test.store.sourceUpdates[0].update.consecutive_failures, 3);
  assertEquals("last_success_at" in test.store.sourceUpdates[0].update, false);
  assertEquals(test.store.runInserts[0].status, "error");
  assertEquals(test.store.runInserts[0].error_count, 1);
  assertEquals(
    test.store.runInserts[0].error_code,
    "META_BUSINESS_DISCOVERY_RATE_LIMITED",
  );
});

Deno.test("E/F/G invalid capability, missing scope and Vault failure are fail-closed", async () => {
  for (
    const invalid of [
      { ...connection, capabilities: { radar_read: false } },
      { ...connection, granted_scopes: scopes.slice(0, -1) },
    ]
  ) {
    const test = await runAdvanced({
      sources: [source],
      connections: { [source.cliente_id]: invalid },
    });
    assertEquals(test.store.secretReads.length, 0);
    assertEquals(test.providerOptions.length, 0);
    assertEquals(test.store.ingestCalls.length, 0);
    assertEquals(
      test.store.sourceUpdates[0].update.last_error_code,
      "META_RADAR_CAPABILITY_UNAVAILABLE",
    );
    assertEquals(
      test.store.runInserts[0].error_code,
      "META_RADAR_CAPABILITY_UNAVAILABLE",
    );
  }
  const vault = await runAdvanced({
    sources: [source],
    secrets: { "vault-ref": null },
  });
  assertEquals(vault.providerOptions.length, 0);
  assertEquals(vault.store.ingestCalls.length, 0);
  assertEquals(
    vault.store.sourceUpdates[0].update.last_error_code,
    "META_RADAR_SECRET_UNAVAILABLE",
  );
});

Deno.test("H item persistence failures continue and produce completed_with_errors", async () => {
  const second = item({
    externalId: "second",
    canonicalUrl: "https://www.instagram.com/p/second/",
  });
  const test = await runAdvanced({
    sources: [source],
    ingest: [new Error("database details"), true],
    collections: {
      [source.id]: collection(source.id, { items: [item(), second] }),
    },
  });
  assertEquals(test.store.ingestCalls.length, 2);
  assertEquals(test.body.results[0].valid, 2);
  assertEquals(test.body.results[0].collected, 1);
  assertEquals(test.body.results[0].errors, 1);
  assertEquals(
    test.store.sourceUpdates[0].update.last_error_code,
    "ITEM_PERSIST_FAILED",
  );
  assertEquals(test.store.sourceUpdates[0].update.consecutive_failures, 0);
  assertEquals(test.store.sourceUpdates[0].update.last_collected_count, 1);
  assertEquals(test.store.runInserts[0].status, "completed_with_errors");
  assertEquals(test.store.runInserts[0].error_count, 1);
  assertEquals(test.store.runInserts[0].error_code, "ITEM_PERSIST_FAILED");
});

Deno.test("J/K infrastructure writes terminate at sanitized HTTP boundaries", async () => {
  for (
    const [options, code] of [[
      { updateError: true },
      "RADAR_SOURCE_STATE_WRITE_FAILED",
    ], [{ insertError: true }, "RADAR_INGESTION_RUN_WRITE_FAILED"]] as const
  ) {
    const test = await runAdvanced({ sources: [source], ...options });
    assertEquals(test.response.status, 500);
    assertEquals(test.body, { error: code });
    assertEquals(test.body.ok, undefined);
  }
});

Deno.test("L/M batches each tenant once and never crosses credentials", async () => {
  const sourceB: RadarSource = {
    ...source,
    id: "source-b",
    url: "https://www.instagram.com/camara/",
  };
  const same = await runAdvanced({ sources: [source, sourceB] });
  assertEquals(same.store.connectionLoads, ["tenant-a"]);
  assertEquals(same.store.secretReads, ["vault-ref"]);
  assertEquals(same.providerOptions.length, 1);
  assertEquals(same.collectCalls.length, 1);
  assertEquals(same.collectCalls[0].sources.map((value) => value.id), [
    source.id,
    sourceB.id,
  ]);
  assertEquals(same.store.sourceUpdates.length, 2);
  assertEquals(same.store.runInserts.length, 2);
  const tenantB = "tenant-b";
  const sourceOther: RadarSource = {
    ...source,
    id: "source-other",
    cliente_id: tenantB,
    url: "https://www.instagram.com/portal/",
  };
  const connectionB: RadarConnection = {
    ...connection,
    instagram_user_id: "caller-b",
    token_secret_ref: "ref-b",
  };
  const separate = await runAdvanced({
    sources: [source, sourceOther],
    connections: { "tenant-a": connection, [tenantB]: connectionB },
    secrets: { "vault-ref": "token-a", "ref-b": "token-b" },
  });
  assertEquals(separate.providerOptions, [{
    graphApiVersion: "v26.0",
    instagramUserId: "caller",
    pageAccessToken: "token-a",
  }, {
    graphApiVersion: "v26.0",
    instagramUserId: "caller-b",
    pageAccessToken: "token-b",
  }]);
});

Deno.test("N/O invalid and disabled sources are not sent to the provider", async () => {
  const invalid: RadarSource = {
    ...source,
    id: "invalid",
    url: "https://evil.example/not-instagram",
  };
  const valid: RadarSource = {
    ...source,
    id: "valid",
    url: "https://www.instagram.com/valid/",
  };
  const test = await runAdvanced({ sources: [invalid, valid] });
  assertEquals(test.collectCalls[0].sources.map((value) => value.id), [
    "valid",
  ]);
  assertEquals(
    test.store.runInserts.find((run) => run.source_id === "invalid")
      ?.error_code,
    "META_RADAR_SOURCE_INVALID",
  );
  assert(
    test.store.ingestCalls.every((input) => input.p_source_id !== "invalid"),
  );
  const disabled = await runAdvanced({
    sources: [source],
    disabledTenantIds: ["tenant-a"],
  });
  assertEquals(disabled.store.connectionLoads.length, 0);
  assertEquals(disabled.store.secretReads.length, 0);
  assertEquals(disabled.providerOptions.length, 0);
  assertEquals(disabled.store.ingestCalls.length, 0);
});

Deno.test("security serialization excludes tokens, captions, raw paging and cursors", async () => {
  const sensitiveCaption = "CAPTION-NEVER-EXPOSE";
  const test = await runAdvanced({
    sources: [source],
    collections: {
      [source.id]: collection(source.id, {
        items: [item({ caption: sensitiveCaption })],
      }),
    },
  });
  const serialized = JSON.stringify({
    response: test.body,
    run: test.store.runInserts[0].metadata,
    telemetry: test.telemetry,
  });
  for (
    const secret of [
      "page-token",
      "vault-ref",
      "access_token",
      sensitiveCaption,
      "paging.next",
      "paging",
      "cursor",
    ]
  ) assert(!serialized.includes(secret));
});
