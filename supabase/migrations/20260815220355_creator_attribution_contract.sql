-- Persist an immutable creator label for user-facing audit signatures while
-- keeping the existing creator UUIDs as the authorization source of truth.

ALTER TABLE public.tarefas
    ADD COLUMN IF NOT EXISTS created_by_name_snapshot text;

ALTER TABLE ap.candidate_news
    ADD COLUMN IF NOT EXISTS creator_name_snapshot text;

ALTER TABLE public.reunioes
    ADD COLUMN IF NOT EXISTS criada_por_name_snapshot text;

COMMENT ON COLUMN public.tarefas.created_by_name_snapshot IS
    'Creator display name captured when the OS is created. Authorization continues to use created_by.';

COMMENT ON COLUMN ap.candidate_news.creator_name_snapshot IS
    'Creator display name captured when the article is created. Automated records use AutoPublisher.';

COMMENT ON COLUMN public.reunioes.criada_por_name_snapshot IS
    'Creator display name captured when the meeting is created. Authorization continues to use criada_por.';

-- Backfill only identities that can be proven from the existing UUID.
UPDATE public.tarefas AS task
SET created_by_name_snapshot = professional.nome
FROM public.profissionais AS professional
WHERE professional.id = task.created_by
  AND NULLIF(btrim(task.created_by_name_snapshot), '') IS NULL;

UPDATE ap.candidate_news AS news
SET creator_name_snapshot = professional.nome
FROM public.profissionais AS professional
WHERE professional.id = news.criado_por_user_id
  AND NULLIF(btrim(news.creator_name_snapshot), '') IS NULL;

UPDATE public.reunioes AS meeting
SET criada_por_name_snapshot = professional.nome
FROM public.profissionais AS professional
WHERE professional.id = meeting.criada_por
  AND NULLIF(btrim(meeting.criada_por_name_snapshot), '') IS NULL;

-- fonte_id is the stable local marker for RSS ingestion.
UPDATE ap.candidate_news
SET creator_name_snapshot = 'AutoPublisher'
WHERE criado_por_user_id IS NULL
  AND fonte_id IS NOT NULL
  AND NULLIF(btrim(creator_name_snapshot), '') IS NULL;

-- Some deployed databases also expose an explicit source column. Use it when
-- present without making fresh databases depend on that historical drift.
DO $block$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ap'
          AND table_name = 'candidate_news'
          AND column_name = 'source'
    ) THEN
        EXECUTE $sql$
            UPDATE ap.candidate_news
            SET creator_name_snapshot = 'AutoPublisher'
            WHERE criado_por_user_id IS NULL
              AND lower(source) = 'rss'
              AND NULLIF(btrim(creator_name_snapshot), '') IS NULL
        $sql$;
    END IF;
END
$block$;

CREATE OR REPLACE FUNCTION public.set_task_creator_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    creator_name text;
BEGIN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());

    IF NEW.created_by IS NULL THEN
        RAISE EXCEPTION 'TASK_CREATOR_REQUIRED'
            USING ERRCODE = '23502';
    END IF;

    IF NULLIF(btrim(NEW.created_by_name_snapshot), '') IS NULL THEN
        SELECT professional.nome
        INTO creator_name
        FROM public.profissionais AS professional
        WHERE professional.id = NEW.created_by;

        NEW.created_by_name_snapshot := COALESCE(
            NULLIF(btrim(creator_name), ''),
            'Autoria não registrada'
        );
    END IF;

    RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.set_task_creator_attribution() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_set_task_creator_attribution ON public.tarefas;
CREATE TRIGGER trg_set_task_creator_attribution
BEFORE INSERT ON public.tarefas
FOR EACH ROW
EXECUTE FUNCTION public.set_task_creator_attribution();

CREATE OR REPLACE FUNCTION public.set_meeting_creator_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    creator_name text;
BEGIN
    NEW.criada_por := COALESCE(NEW.criada_por, auth.uid());

    IF NEW.criada_por IS NULL THEN
        RAISE EXCEPTION 'MEETING_CREATOR_REQUIRED'
            USING ERRCODE = '23502';
    END IF;

    IF NULLIF(btrim(NEW.criada_por_name_snapshot), '') IS NULL THEN
        SELECT professional.nome
        INTO creator_name
        FROM public.profissionais AS professional
        WHERE professional.id = NEW.criada_por;

        NEW.criada_por_name_snapshot := COALESCE(
            NULLIF(btrim(creator_name), ''),
            'Autoria não registrada'
        );
    END IF;

    RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.set_meeting_creator_attribution() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_set_meeting_creator_attribution ON public.reunioes;
CREATE TRIGGER trg_set_meeting_creator_attribution
BEFORE INSERT ON public.reunioes
FOR EACH ROW
EXECUTE FUNCTION public.set_meeting_creator_attribution();

CREATE OR REPLACE FUNCTION ap.set_candidate_creator_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, ap
AS $function$
DECLARE
    creator_name text;
    source_kind text;
BEGIN
    source_kind := lower(COALESCE(to_jsonb(NEW) ->> 'source', ''));

    IF NEW.criado_por_user_id IS NULL AND auth.uid() IS NOT NULL THEN
        NEW.criado_por_user_id := auth.uid();
    END IF;

    IF NULLIF(btrim(NEW.creator_name_snapshot), '') IS NULL
       AND NEW.criado_por_user_id IS NOT NULL THEN
        SELECT professional.nome
        INTO creator_name
        FROM public.profissionais AS professional
        WHERE professional.id = NEW.criado_por_user_id;

        NEW.creator_name_snapshot := NULLIF(btrim(creator_name), '');
    END IF;

    IF NULLIF(btrim(NEW.creator_name_snapshot), '') IS NULL
       AND (NEW.fonte_id IS NOT NULL OR source_kind = 'rss' OR NEW.criado_por_user_id IS NULL) THEN
        NEW.creator_name_snapshot := 'AutoPublisher';
    END IF;

    RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION ap.set_candidate_creator_attribution() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_set_candidate_creator_attribution ON ap.candidate_news;
CREATE TRIGGER trg_set_candidate_creator_attribution
BEFORE INSERT ON ap.candidate_news
FOR EACH ROW
EXECUTE FUNCTION ap.set_candidate_creator_attribution();

-- SELECT * views store their column list at creation time. Refresh them so the
-- public Data API surface includes creator_name_snapshot as the final column.
CREATE OR REPLACE VIEW public.ap_candidate_news AS
SELECT * FROM ap.candidate_news;

CREATE OR REPLACE VIEW public.ap_candidate_news_complete AS
SELECT * FROM ap.candidate_news;
