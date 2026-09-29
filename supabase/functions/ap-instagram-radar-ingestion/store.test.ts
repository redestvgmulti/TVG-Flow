import { assert, assertEquals } from "jsr:@std/assert";
import {
  RadarIngestionStoreError,
  SupabaseRadarIngestionStore,
} from "./store.ts";

function fakeAdmin(result: { error?: unknown; data?: unknown } = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query: any = {};
  for (const method of ["select", "eq", "order", "not", "update"]) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  }
  query.update = (...args: unknown[]) => {
    calls.push({ method: "update", args });
    return {
      eq: () => ({
        eq: async () => ({ error: result.error ?? null }),
      }),
    };
  };
  query.limit = async (...args: unknown[]) => {
    calls.push({ method: "limit", args });
    return { data: result.data ?? [], error: result.error ?? null };
  };
  query.maybeSingle = async () => ({
    data: result.data ?? null,
    error: result.error ?? null,
  });
  query.insert = async (...args: unknown[]) => {
    calls.push({ method: "insert", args });
    return { error: result.error ?? null };
  };
  return {
    calls,
    admin: {
      schema: () => ({
        from: (table: string) => {
          calls.push({ method: "from", args: [table] });
          return query;
        },
        rpc: async (name: string, input: unknown) => {
          calls.push({ method: "rpc", args: [name, input] });
          return { data: result.data, error: result.error ?? null };
        },
      }),
    },
  };
}

Deno.test("Store source query applies Radar filter, fairness, limit and disabled tenants", async () => {
  const fake = fakeAdmin({ data: [] });
  const store = new SupabaseRadarIngestionStore(fake.admin);
  await store.loadInstagramSources(["tenant-disabled"], 25);
  assertEquals(fake.calls.find((value) => value.method === "from")?.args, [
    "sources",
  ]);
  assert(
    fake.calls.some((value) =>
      value.method === "eq" && value.args[0] === "tipo" &&
      value.args[1] === "instagram"
    ),
  );
  assert(
    fake.calls.some((value) =>
      value.method === "eq" && value.args[0] === "ativo" &&
      value.args[1] === true
    ),
  );
  assert(
    fake.calls.some((value) =>
      value.method === "order" && value.args[0] === "last_checked_at"
    ),
  );
  assert(
    fake.calls.some((value) =>
      value.method === "order" && value.args[0] === "created_at"
    ),
  );
  assert(
    fake.calls.some((value) =>
      value.method === "not" && value.args[0] === "cliente_id"
    ),
  );
  assert(
    fake.calls.some((value) =>
      value.method === "limit" && value.args[0] === 25
    ),
  );
});

Deno.test("Store uses canonical Vault and collected-news RPCs", async () => {
  const secret = fakeAdmin({ data: "safe-token" });
  await new SupabaseRadarIngestionStore(secret.admin).readMetaSecret(
    "secret-ref",
  );
  assertEquals(secret.calls[0], {
    method: "rpc",
    args: ["meta_read_secret", { p_secret_id: "secret-ref" }],
  });
  const ingest = fakeAdmin({ data: { created: true } });
  const outcome = await new SupabaseRadarIngestionStore(ingest.admin)
    .ingestCollectedNews({} as never);
  assertEquals(outcome, { created: true });
  assertEquals(ingest.calls[0].args[0], "ingest_collected_news");
});

Deno.test("Store sanitizes write failures without leaking database details", async () => {
  const sql = { message: "sensitive SQL", details: "details", hint: "hint" };
  const state = new SupabaseRadarIngestionStore(
    fakeAdmin({ error: sql }).admin,
  );
  try {
    await state.updateSourceState("s", "c", {} as never);
    throw new Error("expected");
  } catch (error) {
    assert(error instanceof RadarIngestionStoreError);
    assertEquals(error.code, "RADAR_SOURCE_STATE_WRITE_FAILED");
    assertEquals(error.message, "RADAR_SOURCE_STATE_WRITE_FAILED");
  }
  const run = new SupabaseRadarIngestionStore(fakeAdmin({ error: sql }).admin);
  try {
    await run.insertIngestionRun({} as never);
    throw new Error("expected");
  } catch (error) {
    assert(error instanceof RadarIngestionStoreError);
    assertEquals(error.code, "RADAR_INGESTION_RUN_WRITE_FAILED");
    assertEquals(error.message, "RADAR_INGESTION_RUN_WRITE_FAILED");
  }
});
