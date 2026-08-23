-- Production P0 follow-up (2026-08-23).
-- Scope: anonymous grants inherited from historical default privileges and
-- owner-executed diagnostic views discovered by the post-deploy schema dump.
-- No domain or historical row is changed.

BEGIN;

SET LOCAL search_path = pg_catalog, public, ap, extensions;

-- Existing relations in the exposed schemas are default-deny for anonymous
-- PostgREST access. Authenticated grants and RLS policies are preserved.
DO $$
DECLARE
    v_relation record;
    v_sequence record;
    v_function record;
BEGIN
    FOR v_relation IN
        SELECT n.nspname AS schema_name, c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('public', 'ap')
           AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon',
            v_relation.schema_name,
            v_relation.relname
        );
    END LOOP;

    FOR v_sequence IN
        SELECT n.nspname AS schema_name, c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('public', 'ap')
           AND c.relkind = 'S'
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM anon',
            v_sequence.schema_name,
            v_sequence.relname
        );
    END LOOP;

    FOR v_function IN
        SELECT p.oid::regprocedure::text AS regprocedure
         FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public', 'ap')
           AND p.prokind = 'f'
           AND NOT EXISTS (
               SELECT 1
                 FROM pg_depend d
                WHERE d.classid = 'pg_proc'::regclass
                  AND d.objid = p.oid
                  AND d.deptype = 'e'
           )
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon',
            v_function.regprocedure
        );
    END LOOP;
END;
$$;

-- Views execute with the caller privileges so they cannot bypass underlying
-- table RLS through the view owner.
DO $$
DECLARE
    v_view record;
BEGIN
    FOR v_view IN
        SELECT n.nspname AS schema_name, c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('public', 'ap')
           AND c.relkind = 'v'
    LOOP
        EXECUTE format(
            'ALTER VIEW %I.%I SET (security_invoker = true)',
            v_view.schema_name,
            v_view.relname
        );
    END LOOP;
END;
$$;

-- Operational diagnostics have no browser runtime caller. Keep every one that
-- exists in the deployed schema service-only. Some are production-only drift,
-- so the migration must remain valid against an empty canonical rebuild.
DO $$
DECLARE
    v_object_name text;
    v_relation regclass;
BEGIN
    FOR v_object_name IN
        SELECT object_name
          FROM (
              VALUES
                  ('ap._audit_patrocinadores'),
                  ('ap._debug_patrocinadores_summary'),
                  ('ap._debug_template_check'),
                  ('ap.v_cost_summary'),
                  ('ap.v_pipeline_health'),
                  ('ap.v_throughput'),
                  ('public.v_feed_institucional_publico'),
                  ('public.vw_active_locks'),
                  ('public.vw_admin_tenant_compliance'),
                  ('public.vw_blocked_queries'),
                  ('public.vw_notification_queue_alerts'),
                  ('public.vw_notification_queue_health'),
                  ('public.vw_ordem_diagnostics'),
                  ('public.vw_slow_queries'),
                  ('public.vw_table_sizes')
          ) AS operational_views(object_name)
    LOOP
        v_relation := to_regclass(v_object_name);
        IF v_relation IS NOT NULL THEN
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated',
                v_relation
            );
            EXECUTE format(
                'GRANT SELECT ON TABLE %s TO service_role',
                v_relation
            );
        END IF;
    END LOOP;
END;
$$;

-- Historical defaults were re-opening every newly created object to both API
-- roles. Future objects now require an explicit versioned grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ap
    REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ap
    REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ap
    REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'ap')
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND (
           has_table_privilege('anon', c.oid, 'SELECT')
           OR has_table_privilege('anon', c.oid, 'INSERT')
           OR has_table_privilege('anon', c.oid, 'UPDATE')
           OR has_table_privilege('anon', c.oid, 'DELETE')
           OR has_table_privilege('anon', c.oid, 'TRUNCATE')
           OR has_table_privilege('anon', c.oid, 'REFERENCES')
           OR has_table_privilege('anon', c.oid, 'TRIGGER')
       );
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'P0_POSTCONDITION_FAILED: % exposed relations retain anon grants',
            v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'ap')
       AND p.prokind = 'f'
       AND NOT EXISTS (
           SELECT 1
             FROM pg_depend d
            WHERE d.classid = 'pg_proc'::regclass
              AND d.objid = p.oid
              AND d.deptype = 'e'
       )
       AND has_function_privilege('anon', p.oid, 'EXECUTE');
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'P0_POSTCONDITION_FAILED: % exposed functions retain anon execute',
            v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'ap')
       AND c.relkind = 'v'
       AND NOT coalesce(c.reloptions, ARRAY[]::text[])
               @> ARRAY['security_invoker=true'];
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'P0_POSTCONDITION_FAILED: % exposed views are not security_invoker',
            v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_default_acl d
      JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
     WHERE owner_role.rolname = 'postgres'
       AND n.nspname IN ('public', 'ap')
       AND (
           acl.grantee = 0 -- PUBLIC
           OR acl.grantee IN (
               (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
               (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
           )
       );
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'P0_POSTCONDITION_FAILED: % permissive API default ACL entries remain',
            v_count;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Logical rollback: restore only the reviewed object grants/default ACLs from
-- the pre-migration schema dump. No table row or historical data restore is
-- required. Reverting security_invoker requires an explicit reviewed ALTER
-- VIEW per affected view.
