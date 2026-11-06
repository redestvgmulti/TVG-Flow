-- A stale editorial revision is a domain conflict, not a retryable
-- serialization failure. Older PostgREST/hasql versions retry 40001 inside
-- the same HTTP request forever, even though the supplied revision is fixed.
-- Change only this RAISE in the five existing signatures. Reading each live
-- definition preserves its current authorization, locking, return shape and
-- idempotency; CREATE OR REPLACE preserves ownership and EXECUTE grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
    v_signature text;
    v_function regprocedure;
    v_definition text;
    v_old text := '''EDITORIAL_REVISION_CONFLICT'' USING ERRCODE = ''40001''';
    v_new text := '''EDITORIAL_REVISION_CONFLICT'' USING ERRCODE = ''PT409''';
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'ap.save_editorial_article_draft(uuid,text,text,uuid,integer)',
        'ap.finalize_editorial_article(uuid,text,text,uuid,integer)',
        'ap.save_editorial_article_draft_v2(uuid,text,text,text,text,text,jsonb,uuid,integer)',
        'ap.finalize_editorial_article_v2(uuid,text,text,text,text,text,jsonb,uuid,integer)',
        'ap.approve_editorial_article_for_render(uuid,integer,uuid)'
    ] LOOP
        v_function := pg_catalog.to_regprocedure(v_signature);
        IF v_function IS NULL THEN
            RAISE EXCEPTION 'Missing editorial function: %', v_signature;
        END IF;
        v_definition := pg_catalog.pg_get_functiondef(v_function);
        IF pg_catalog.strpos(v_definition, v_old) > 0 THEN
            IF (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
                / pg_catalog.length(v_old) <> 1 THEN
                RAISE EXCEPTION 'Unexpected editorial conflict definition: %', v_signature;
            END IF;
            EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
        ELSIF pg_catalog.strpos(v_definition, v_new) = 0 THEN
            RAISE EXCEPTION 'Editorial conflict guard not found: %', v_signature;
        END IF;
    END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
