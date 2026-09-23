import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const migration = await readFile(
  new URL("../supabase/migrations/20260907183019_secure_native_chat_foundation.sql", import.meta.url),
  "utf8",
);
const uiOperationsMigration = await readFile(
  new URL("../supabase/migrations/20260907201345_native_chat_ui_operations.sql", import.meta.url),
  "utf8",
);
const editorialActionsMigration = await readFile(
  new URL("../supabase/migrations/20260907213000_native_chat_editorial_actions.sql", import.meta.url),
  "utf8",
);
const imageTreatmentMigration = await readFile(
  new URL("../supabase/migrations/20260907224500_private_chat_image_treatment.sql", import.meta.url),
  "utf8",
);
const runtimeEnabled = process.env.RUN_LOCAL_CHAT_SQL === "1";
const connection = {
  host: process.env.LOCAL_PG_HOST || "127.0.0.1",
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || "postgres",
  password: process.env.LOCAL_PG_PASSWORD || "postgres",
  database: process.env.LOCAL_PG_DATABASE || "postgres",
};

test("chat migration compiles and enforces private RLS and idempotency in PostgreSQL", {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_chat_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client(connection);
  let client;
  await admin.connect();

  try {
    const roles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')",
    );
    assert.equal(roles.rowCount, 3, "requires a local Supabase Postgres cluster");
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    client = new pg.Client({ ...connection, database: databaseName });
    await client.connect();

    await client.query(`
      CREATE SCHEMA auth;
      CREATE SCHEMA ap;
      CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      CREATE TABLE public.clientes (id uuid PRIMARY KEY);
      CREATE TABLE public.profissionais (id uuid PRIMARY KEY, role text NOT NULL, ativo boolean NOT NULL);
      CREATE TABLE public.operational_clients (profissional_id uuid NOT NULL, cliente_id uuid NOT NULL);
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean NOT NULL,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      CREATE TABLE ap.editorial_prompt_versions (
        id uuid PRIMARY KEY,
        cliente_id uuid NOT NULL REFERENCES public.clientes(id),
        version_number integer NOT NULL,
        prompt_base text NOT NULL,
        is_active boolean NOT NULL DEFAULT false
      );
      CREATE FUNCTION public.require_single_operational_cliente_id() RETURNS uuid
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
      DECLARE v_ids uuid[];
      BEGIN
        IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
        SELECT array_agg(cliente_id ORDER BY cliente_id) INTO v_ids
          FROM public.operational_clients WHERE profissional_id = auth.uid();
        IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
          RAISE EXCEPTION 'OPERATIONAL_CLIENT_NOT_FOUND';
        END IF;
        IF array_length(v_ids, 1) <> 1 THEN
          RAISE EXCEPTION 'OPERATIONAL_CLIENT_SELECTION_REQUIRED';
        END IF;
        RETURN v_ids[1];
      END;
      $$;
      REVOKE ALL ON FUNCTION public.require_single_operational_cliente_id() FROM PUBLIC, anon, service_role;
      GRANT EXECUTE ON FUNCTION public.require_single_operational_cliente_id() TO authenticated;
      GRANT USAGE ON SCHEMA public, ap, auth TO anon, authenticated, service_role;
    `);
    await client.query(migration);
    await client.query(uiOperationsMigration);
    await client.query(editorialActionsMigration);
    await client.query(imageTreatmentMigration);

    const ids = {
      tenantA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      tenantB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      userA: "11111111-1111-4111-8111-111111111111",
      userB: "22222222-2222-4222-8222-222222222222",
      userC: "33333333-3333-4333-8333-333333333333",
      userZero: "44444444-4444-4444-8444-444444444444",
      userMany: "55555555-5555-4555-8555-555555555555",
      promptA: "66666666-6666-4666-8666-666666666666",
      promptB: "77777777-7777-4777-8777-777777777777",
      requestA: "88888888-8888-4888-8888-888888888888",
      requestB: "99999999-9999-4999-8999-999999999999",
      requestC: "aaaaaaaa-1111-4111-8111-111111111111",
      requestSpoof: "bbbbbbbb-1111-4111-8111-111111111111",
      emptyConversation: "cccccccc-1111-4111-8111-111111111111",
      requestTitle: "dddddddd-1111-4111-8111-111111111111",
    };
    await client.query("INSERT INTO public.clientes(id) VALUES ($1), ($2)", [ids.tenantA, ids.tenantB]);
    await client.query(
      `INSERT INTO public.profissionais(id, role, ativo) VALUES
         ($1, 'admin', true), ($2, 'admin', true), ($3, 'staff', true),
         ($4, 'staff', true), ($5, 'staff', true)`,
      [ids.userA, ids.userB, ids.userC, ids.userZero, ids.userMany],
    );
    await client.query(
      `INSERT INTO public.operational_clients(profissional_id, cliente_id) VALUES
         ($1, $4), ($2, $4), ($3, $5), ($6, $4), ($6, $5)`,
      [ids.userA, ids.userB, ids.userC, ids.tenantA, ids.tenantB, ids.userMany],
    );
    await client.query(
      `INSERT INTO ap.editorial_prompt_versions(id, cliente_id, version_number, prompt_base, is_active)
         VALUES ($1, $3, 1, 'prompt A', true), ($2, $4, 1, 'prompt B', true)`,
      [ids.promptA, ids.promptB, ids.tenantA, ids.tenantB],
    );

    async function claim({ requestId, tenantId, userId, promptId, conversationId = null, title = null, operation = "chat" }) {
      return client.query(
        `SELECT ap.claim_ai_chat_run(
          $1::uuid, $7::text, $2::uuid, $3::uuid, $5::uuid, $6::text,
          'mensagem', 'gpt-5.6-luna', $4::uuid, repeat('a', 64),
          'openai-standard-2026-09-07'
        ) AS result`,
        [requestId, tenantId, userId, promptId, conversationId, title, operation],
      );
    }

    await client.query("SET ROLE service_role");
    const created = await client.query(
      "SELECT ap.create_ai_conversation($1::uuid, $2::uuid, $3::uuid) AS result",
      [ids.emptyConversation, ids.tenantA, ids.userA],
    );
    assert.equal(created.rows[0].result.title, "Nova conversa");
    await claim({
      requestId: ids.requestTitle,
      tenantId: ids.tenantA,
      userId: ids.userA,
      promptId: ids.promptA,
      conversationId: ids.emptyConversation,
      title: "Primeiro pedido",
    });
    assert.equal(
      (await client.query("SELECT title FROM ap.ai_conversations WHERE id = $1", [ids.emptyConversation])).rows[0].title,
      "Primeiro pedido",
    );
    assert.equal(
      (await client.query("SELECT ap.archive_ai_conversation($1::uuid, $2::uuid, $3::uuid) AS archived", [ids.emptyConversation, ids.tenantA, ids.userB])).rows[0].archived,
      false,
    );
    assert.equal(
      (await client.query("SELECT ap.archive_ai_conversation($1::uuid, $2::uuid, $3::uuid) AS archived", [ids.emptyConversation, ids.tenantA, ids.userA])).rows[0].archived,
      true,
    );
    const first = (await claim({ requestId: ids.requestA, tenantId: ids.tenantA, userId: ids.userA, promptId: ids.promptA })).rows[0].result;
    const duplicate = (await claim({ requestId: ids.requestA, tenantId: ids.tenantA, userId: ids.userA, promptId: ids.promptA })).rows[0].result;
    assert.equal(first.claimed, true);
    assert.equal(duplicate.claimed, false);
    assert.equal(first.run_id, duplicate.run_id);
    const trace = await client.query(
      "SELECT prompt_version_id, prompt_hash, pricing_version, provider, operation FROM ap.ai_runs WHERE id = $1",
      [first.run_id],
    );
    assert.deepEqual(trace.rows[0], {
      prompt_version_id: ids.promptA,
      prompt_hash: "a".repeat(64),
      pricing_version: "openai-standard-2026-09-07",
      provider: "openai",
      operation: "chat",
    });

    await client.query("SELECT ap.fail_ai_chat_run($1::uuid, 'OPENAI_HTTP_503', 10)", [first.run_id]);
    const retry = (await claim({ requestId: ids.requestA, tenantId: ids.tenantA, userId: ids.userA, promptId: ids.promptA })).rows[0].result;
    assert.equal(retry.claimed, true);
    await client.query(
      "SELECT ap.complete_ai_chat_run($1::uuid, 'resposta', 'gpt-5.6-luna', 'resp_fake', 100, 20, 30, 0.0001, 'USD', 12)",
      [first.run_id],
    );
    await client.query(
      "SELECT ap.complete_ai_chat_run($1::uuid, 'resposta diferente', 'gpt-5.6-luna', 'resp_other', 100, 20, 30, 0.0001, 'USD', 12)",
      [first.run_id],
    );
    const counts = await client.query(
      "SELECT role, count(*)::int AS count FROM ap.ai_messages WHERE ai_run_id = $1 GROUP BY role ORDER BY role",
      [first.run_id],
    );
    assert.deepEqual(counts.rows, [{ role: "assistant", count: 1 }, { role: "user", count: 1 }]);

    await claim({ requestId: ids.requestB, tenantId: ids.tenantA, userId: ids.userB, promptId: ids.promptA });
    await claim({ requestId: ids.requestC, tenantId: ids.tenantB, userId: ids.userC, promptId: ids.promptB });
    await assert.rejects(
      claim({
        requestId: ids.requestSpoof,
        tenantId: ids.tenantA,
        userId: ids.userB,
        promptId: ids.promptA,
        conversationId: first.conversation_id,
      }),
      /CHAT_CONVERSATION_FORBIDDEN/,
    );
    await client.query("RESET ROLE");

    async function visibleAs(userId) {
      await client.query("SET ROLE authenticated");
      try {
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
        const conversations = await client.query("SELECT user_id, cliente_id FROM ap.ai_conversations ORDER BY user_id");
        const messages = await client.query("SELECT count(*)::int AS count FROM ap.ai_messages");
        const runs = await client.query("SELECT count(*)::int AS count FROM ap.ai_runs");
        return { conversations: conversations.rows, messageCount: messages.rows[0].count, runCount: runs.rows[0].count };
      } finally {
        await client.query("RESET ROLE");
        await client.query("SELECT set_config('request.jwt.claim.sub', '', false)");
      }
    }

    assert.deepEqual(await visibleAs(ids.userA), {
      conversations: [
        { user_id: ids.userA, cliente_id: ids.tenantA },
        { user_id: ids.userA, cliente_id: ids.tenantA },
      ],
      messageCount: 3,
      runCount: 2,
    });
    assert.deepEqual(await visibleAs(ids.userB), {
      conversations: [{ user_id: ids.userB, cliente_id: ids.tenantA }], messageCount: 1, runCount: 1,
    });
    assert.deepEqual(await visibleAs(ids.userC), {
      conversations: [{ user_id: ids.userC, cliente_id: ids.tenantB }], messageCount: 1, runCount: 1,
    });
    await assert.rejects(visibleAs(ids.userZero), /OPERATIONAL_CLIENT_NOT_FOUND/);
    await assert.rejects(visibleAs(ids.userMany), /OPERATIONAL_CLIENT_SELECTION_REQUIRED/);

    await client.query("SET ROLE anon");
    await assert.rejects(client.query("SELECT * FROM ap.ai_conversations"), /permission denied/i);
    await client.query("RESET ROLE");

    await client.query("SET ROLE service_role");
    const editorialOperations = [
      "generate_from_link", "rewrite", "improve_title", "correct", "summarize", "variations",
    ];
    for (const operation of editorialOperations) {
      const requestId = randomUUID();
      const result = (await claim({
        requestId,
        tenantId: ids.tenantA,
        userId: ids.userA,
        promptId: ids.promptA,
        operation,
      })).rows[0].result;
      const recorded = await client.query("SELECT operation FROM ap.ai_runs WHERE id = $1", [result.run_id]);
      assert.equal(recorded.rows[0].operation, operation);
    }
    const imageRequestId = randomUUID();
    const imageClaim = (await client.query(
      `SELECT ap.claim_ai_image_run(
        $1::uuid, $2::uuid, $3::uuid, NULL::uuid, 'Tratamento de imagem',
        '{"type":"image_edit","text":"melhorar nitidez"}', 'gpt-image-2',
        $4::uuid, repeat('b', 64), 'openai-image-standard-2026-09-07'
      ) AS result`,
      [imageRequestId, ids.tenantA, ids.userA, ids.promptA],
    )).rows[0].result;
    const originalAssetId = randomUUID();
    const originalPath = `${ids.tenantA}/${ids.userA}/${imageClaim.conversation_id}/${imageClaim.run_id}/original.png`;
    const original = (await client.query(
      `SELECT ap.register_ai_image_original(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
        'image/png', 'png', 1024, 512, 512, repeat('c', 64)
      ) AS result`,
      [imageClaim.run_id, originalAssetId, ids.tenantA, ids.userA, originalPath],
    )).rows[0].result;
    assert.equal(original.kind, "original");
    const resultAssetId = randomUUID();
    const resultPath = `${ids.tenantA}/${ids.userA}/${imageClaim.conversation_id}/${imageClaim.run_id}/result-${resultAssetId}.png`;
    await client.query(
      `SELECT ap.complete_ai_image_run(
        $1::uuid, $2::uuid, $3::text, 'image/png', 'png', 2048, 512, 512,
        repeat('d', 64), '{"type":"image_edit_result","text":"pronta"}',
        'gpt-image-2', 'req_fake_image', 1400, 100, 1300, 900, 900, 0.0384, 1200
      )`,
      [imageClaim.run_id, resultAssetId, resultPath],
    );
    const imageTrace = await client.query(
      `SELECT operation, provider, requested_model, actual_model, pricing_version,
              input_tokens, input_text_tokens, input_image_tokens,
              output_tokens, output_image_tokens, cost_estimate::text AS cost_estimate, status
         FROM ap.ai_runs WHERE id = $1`,
      [imageClaim.run_id],
    );
    assert.deepEqual(imageTrace.rows[0], {
      operation: "image_edit",
      provider: "openai",
      requested_model: "gpt-image-2",
      actual_model: "gpt-image-2",
      pricing_version: "openai-image-standard-2026-09-07",
      input_tokens: "1400",
      input_text_tokens: "100",
      input_image_tokens: "1300",
      output_tokens: "900",
      output_image_tokens: "900",
      cost_estimate: "0.03840000",
      status: "completed",
    });
    const assets = await client.query(
      "SELECT kind, source_image_id, storage_path FROM ap.ai_image_assets WHERE ai_run_id = $1 ORDER BY kind",
      [imageClaim.run_id],
    );
    assert.equal(assets.rowCount, 2);
    assert.equal(assets.rows.find((asset) => asset.kind === "original").source_image_id, null);
    assert.equal(assets.rows.find((asset) => asset.kind === "result").source_image_id, originalAssetId);
    assert.notEqual(assets.rows[0].storage_path, assets.rows[1].storage_path);
    await client.query("RESET ROLE");

    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids.userB]);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM ap.ai_image_assets")).rows[0].count, 0);
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('request.jwt.claim.sub', '', false)");

    const bucket = await client.query(
      "SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'chat-private-images'",
    );
    assert.deepEqual(bucket.rows[0], {
      public: false,
      file_size_limit: "10485760",
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
    });

    const privileges = await client.query(`
      SELECT
        has_table_privilege('authenticated', 'ap.ai_conversations', 'SELECT') AS authenticated_select,
        has_table_privilege('authenticated', 'ap.ai_conversations', 'INSERT') AS authenticated_insert,
        has_table_privilege('service_role', 'ap.ai_conversations', 'INSERT') AS service_insert,
        has_table_privilege('authenticated', 'ap.ai_image_assets', 'SELECT') AS authenticated_image_select,
        has_table_privilege('authenticated', 'ap.ai_image_assets', 'INSERT') AS authenticated_image_insert,
        has_table_privilege('service_role', 'ap.ai_image_assets', 'INSERT') AS service_image_insert,
        has_function_privilege(
          'authenticated',
          'ap.claim_ai_chat_run(uuid,text,uuid,uuid,uuid,text,text,text,uuid,text,text)',
          'EXECUTE'
        ) AS authenticated_claim,
        has_function_privilege(
          'authenticated',
          'ap.archive_ai_conversation(uuid,uuid,uuid)',
          'EXECUTE'
        ) AS authenticated_archive
    `);
    assert.deepEqual(privileges.rows[0], {
      authenticated_select: true,
      authenticated_insert: false,
      service_insert: false,
      authenticated_image_select: true,
      authenticated_image_insert: false,
      service_image_insert: false,
      authenticated_claim: false,
      authenticated_archive: false,
    });
  } finally {
    if (client) await client.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
});
