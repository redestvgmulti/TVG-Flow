import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pg from 'pg'

const root = new URL('../../', import.meta.url)
const migration = path => readFile(new URL(`supabase/migrations/${path}`, root), 'utf8')
const runtimeEnabled = process.env.RUN_LOCAL_HISTORICAL_MIGRATION_SQL === '1'

const connection = {
  host: process.env.LOCAL_PG_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT || 54322),
  user: process.env.LOCAL_PG_USER || 'postgres',
  password: process.env.LOCAL_PG_PASSWORD || 'postgres',
  database: process.env.LOCAL_PG_DATABASE || 'postgres',
}

const firstName = '20260318171700_fix_os_deletion_bug.sql'
const secondName = '20260318203441_fix_os_deletion_bug.sql'
const expectedTarget = '(is_admin_safe()oris_super_admin()or(created_by=auth.uid())oris_user_assigned_to_task(id))'

async function policy(client) {
  const result = await client.query(`
    SELECT
      roles::text[] AS roles,
      cmd,
      permissive,
      lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) AS using_expression,
      lower(regexp_replace(with_check, '[[:space:]]+', '', 'g')) AS check_expression
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tarefas'
      AND policyname = 'RLS: admin ou envolvidos podem modificar'
  `)
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

function assertTargetPolicy(row) {
  assert.deepEqual(row.roles, ['public'])
  assert.equal(row.cmd, 'ALL')
  assert.equal(row.permissive, 'PERMISSIVE')
  assert.equal(row.using_expression, expectedTarget)
  assert.equal(row.check_expression, expectedTarget)
}

test('historical migration guards the known predecessor, exact replay and drift', async () => {
  const [first, second] = await Promise.all([migration(firstName), migration(secondName)])

  assert.notEqual(first, second, 'the migrations are not byte-identical and must not become a no-op')
  assert.match(first, /TO authenticated/)
  assert.match(first, /assigned_to = auth\.uid\(\)/)
  assert.match(second, /policy_state := 'predecessor'/)
  assert.match(second, /policy_state := 'target'/)
  assert.match(second, /unexpected definition/)
  assert.match(second, /is_user_assigned_to_task\(tarefas\.id\)/)
  assert.doesNotMatch(second, /EXCEPTION WHEN OTHERS|USING\s*\(\s*true\s*\)|CREATE POLICY IF NOT EXISTS/i)
})

test('corrected migration passes predecessor, replay and missing states but rejects drift', {
  skip: !runtimeEnabled,
}, async () => {
  const databaseName = `tvg_policy_reset_${randomUUID().replaceAll('-', '')}`
  assert.match(databaseName, /^[a-z0-9_]+$/)

  const admin = new pg.Client(connection)
  let client
  await admin.connect()

  try {
    const roles = await admin.query("SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
    assert.equal(roles.rowCount, 2, 'the runtime test requires a local Supabase Postgres cluster')
    await admin.query(`CREATE DATABASE "${databaseName}"`)

    client = new pg.Client({ ...connection, database: databaseName })
    await client.connect()

    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE public.tarefas (
        id uuid PRIMARY KEY,
        created_by uuid,
        assigned_to uuid
      );
      CREATE TABLE public.tarefas_micro (
        tarefa_id uuid,
        profissional_id uuid
      );
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      CREATE FUNCTION public.is_admin_safe()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      AS 'SELECT COALESCE(
        current_setting(''test.is_admin'', true) = ''true'',
        false
      )';
      CREATE FUNCTION public.is_super_admin()
      RETURNS boolean
      LANGUAGE sql
      STABLE
      AS 'SELECT false';
      CREATE FUNCTION public.is_user_assigned_to_task(task_id uuid)
      RETURNS boolean
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS 'SELECT EXISTS (
        SELECT 1
        FROM public.tarefas_micro tm
        WHERE tm.tarefa_id = task_id
          AND tm.profissional_id = auth.uid()
      )';
    `)

    const [first, second] = await Promise.all([migration(firstName), migration(secondName)])

    // Scenario A: the exact predecessor is upgraded without widening access.
    await client.query(first)
    await client.query(second)
    assertTargetPolicy(await policy(client))

    // Scenario B: replay is a no-op for the protected policy definition.
    await client.query(second)
    assertTargetPolicy(await policy(client))

    // Scenario C: an unexpected permissive policy is rejected and preserved.
    await client.query(`
      DROP POLICY "RLS: admin ou envolvidos podem modificar" ON public.tarefas;
      CREATE POLICY "RLS: admin ou envolvidos podem modificar"
      ON public.tarefas
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
    `)
    await assert.rejects(client.query(second), /unexpected definition/)
    const divergent = await policy(client)
    assert.deepEqual(divergent.roles, ['authenticated'])
    assert.equal(divergent.using_expression, 'true')
    assert.equal(divergent.check_expression, 'true')

    // A database that has only the later migration still receives the target.
    await client.query('DROP POLICY "RLS: admin ou envolvidos podem modificar" ON public.tarefas')
    await client.query(second)
    assertTargetPolicy(await policy(client))

    // The preserved PUBLIC role does not grant anonymous access; the predicate
    // still authorizes only admins, creators and micro-task participants.
    const ids = {
      creator: randomUUID(),
      participant: randomUUID(),
      outsider: randomUUID(),
      creatorTask: randomUUID(),
      participantTask: randomUUID(),
      otherTask: randomUUID(),
    }
    await client.query(`
      ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
      GRANT SELECT, UPDATE ON public.tarefas TO anon, authenticated;
      INSERT INTO public.tarefas (id, created_by)
      VALUES
        ('${ids.creatorTask}', '${ids.creator}'),
        ('${ids.participantTask}', '${ids.outsider}'),
        ('${ids.otherTask}', '${ids.outsider}');
      INSERT INTO public.tarefas_micro (tarefa_id, profissional_id)
      VALUES ('${ids.participantTask}', '${ids.participant}');
    `)

    async function updateAs(role, userId, taskId, isAdmin = false) {
      assert.match(role, /^(anon|authenticated)$/)
      await client.query(`SET ROLE ${role}`)
      try {
        await client.query(
          "SELECT set_config('request.jwt.claim.sub', $1, false), set_config('test.is_admin', $2, false)",
          [userId || '', String(isAdmin)],
        )
        return await client.query(
          'UPDATE public.tarefas SET assigned_to = assigned_to WHERE id = $1',
          [taskId],
        )
      } finally {
        await client.query('RESET ROLE')
      }
    }

    assert.equal(
      (await updateAs('authenticated', ids.creator, ids.creatorTask)).rowCount,
      1,
      'creator must remain authorized',
    )
    assert.equal(
      (await updateAs('authenticated', ids.participant, ids.participantTask)).rowCount,
      1,
      'micro-task participant must remain authorized',
    )
    assert.equal(
      (await updateAs('authenticated', ids.participant, ids.otherTask)).rowCount,
      0,
      'unrelated authenticated user must remain denied',
    )
    assert.equal(
      (await updateAs('authenticated', ids.outsider, ids.otherTask, true)).rowCount,
      1,
      'admin must remain authorized',
    )
    assert.equal(
      (await updateAs('anon', null, ids.creatorTask)).rowCount,
      0,
      'anonymous role must remain denied',
    )
  } finally {
    if (client) await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    await admin.end()
  }
})
