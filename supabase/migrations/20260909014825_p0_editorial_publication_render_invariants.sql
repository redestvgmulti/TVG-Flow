-- Prospective invariants. No historical candidate or Storage object is rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Refuse a namespace collision rather than changing ACLs of an unrelated schema.
CREATE SCHEMA ap_private;
REVOKE ALL ON SCHEMA ap_private FROM PUBLIC, anon, authenticated, service_role;
-- Transaction-local capabilities cannot be forged through a session GUC.
CREATE TABLE ap_private.p0_capabilities (
  transaction_id bigint NOT NULL, candidate_id uuid NOT NULL, operation text NOT NULL,
  PRIMARY KEY (transaction_id, candidate_id, operation)
);
REVOKE ALL ON ap_private.p0_capabilities FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE ap.render_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES ap.candidate_news(id) ON DELETE RESTRICT,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('rendering','succeeded','failed','legacy_observed')),
  render_snapshot jsonb NOT NULL,
  render_plan jsonb,
  asset_path text UNIQUE,
  asset_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  UNIQUE(candidate_id,id)
);
ALTER TABLE ap.render_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ap.render_generations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON ap.render_generations TO authenticated, service_role;
CREATE POLICY render_generations_read ON ap.render_generations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM ap.candidate_news c WHERE c.id=candidate_id AND c.cliente_id=render_generations.cliente_id));

ALTER TABLE ap.candidate_news
  ADD COLUMN current_generation_id uuid,
  ADD COLUMN approved_generation_id uuid,
  ADD COLUMN correction_draft jsonb,
  ADD CONSTRAINT candidate_current_generation_fk FOREIGN KEY(id,current_generation_id)
    REFERENCES ap.render_generations(candidate_id,id),
  ADD CONSTRAINT candidate_approved_generation_fk FOREIGN KEY(id,approved_generation_id)
    REFERENCES ap.render_generations(candidate_id,id);

-- Widen the existing status constraint without losing any old accepted value.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT definition FROM pg_constraint
    WHERE conrelid='ap.candidate_news'::regclass AND conname='candidate_news_status_check';
  ALTER TABLE ap.candidate_news DROP CONSTRAINT candidate_news_status_check;
  EXECUTE 'ALTER TABLE ap.candidate_news ADD CONSTRAINT candidate_news_status_check CHECK (('
    || substring(definition from 8 for char_length(definition)-8)
    || ') OR status = ''changes_requested'') NOT VALID';
END;
$migration$;

-- Minimal legacy publication journal, deliberately not the future multi-target model.
CREATE TABLE ap.legacy_publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES ap.candidate_news(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL,
  account_id text NOT NULL CHECK(account_id ~ '^[0-9]+$'),
  stage text NOT NULL CHECK(stage IN ('claimed','container_created','publishing','confirmed','safe_failed','reconciliation_required')),
  container_id text,
  external_media_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(candidate_id,generation_id) REFERENCES ap.render_generations(candidate_id,id)
);
CREATE UNIQUE INDEX legacy_publish_one_unresolved ON ap.legacy_publish_attempts(candidate_id)
  WHERE stage <> 'safe_failed';
ALTER TABLE ap.legacy_publish_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ap.legacy_publish_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON ap.legacy_publish_attempts TO service_role;

CREATE FUNCTION ap_private.require_p0_worker() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION ap_private.editorial_fields(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(jsonb_object_agg(key,val),'{}'::jsonb)
 FROM jsonb_each(value) e(key,val)
 WHERE key = ANY(ARRAY['cliente_id','titulo','conteudo','headline','caption','url_original','source',
 'imagem_url','imagem_storage','context_tag','categoria','visual_title_id','content_type',
 'template_id','template_ordem','template_set','placid_template_uuid','template_nome_snapshot',
 'render_contract_version','render_snapshot','sponsor_count','patrocinador_id','territorial_reservation_id',
 'roteiro_json','roteiro_studio','duracao_estimada','broll_sugestao','studio_media_image_url',
 'studio_media_video_url','visual_energy_level','has_face',
 'se_not_exists_template_id','se_not_exists_template_ordem','se_not_exists_placid_template_uuid',
 'se_not_exists_template_nome_snapshot']);
$$;

CREATE FUNCTION ap_private.guard_candidate_p0() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE permitted boolean; frozen boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM ap_private.p0_capabilities
    WHERE transaction_id=txid_current() AND candidate_id=NEW.id) INTO permitted;
  IF TG_OP='INSERT' THEN
    IF NEW.status IN ('posted','approved','changes_requested') OR NEW.render_url IS NOT NULL OR NEW.current_generation_id IS NOT NULL
       OR NEW.approved_generation_id IS NOT NULL OR NEW.instagram_post_id IS NOT NULL OR NEW.correction_draft IS NOT NULL THEN
      RAISE EXCEPTION 'EXTERNAL_OR_RENDER_EVIDENCE_REQUIRED' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  frozen := OLD.render_url IS NOT NULL OR OLD.status IN ('pending_render','pending_review','render_complete','ready_to_publish','approved','posted')
    OR EXISTS(SELECT 1 FROM ap.render_generations g WHERE g.id=OLD.current_generation_id AND g.status='rendering');
  IF frozen AND ap_private.editorial_fields(to_jsonb(NEW)) IS DISTINCT FROM ap_private.editorial_fields(to_jsonb(OLD))
     AND NOT EXISTS(SELECT 1 FROM ap_private.p0_capabilities WHERE transaction_id=txid_current()
       AND candidate_id=NEW.id AND operation IN ('start_correction','complete_render')) THEN
    RAISE EXCEPTION 'EDITORIAL_CONTENT_FROZEN' USING ERRCODE='23514';
  END IF;
  IF NOT permitted AND (
    NEW.render_url IS DISTINCT FROM OLD.render_url OR NEW.current_generation_id IS DISTINCT FROM OLD.current_generation_id
    OR NEW.approved_generation_id IS DISTINCT FROM OLD.approved_generation_id
    OR NEW.correction_draft IS DISTINCT FROM OLD.correction_draft
    OR NEW.instagram_post_id IS DISTINCT FROM OLD.instagram_post_id
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_by_name IS DISTINCT FROM OLD.approved_by_name
    OR (NEW.status IN ('posted','approved','changes_requested') AND NEW.status IS DISTINCT FROM OLD.status)
    OR (OLD.status IN ('posted','changes_requested') AND NEW.status IS DISTINCT FROM OLD.status)
  ) THEN RAISE EXCEPTION 'CANONICAL_TRANSITION_REQUIRED' USING ERRCODE='23514'; END IF;
  -- Old clients may not discard material while an external request is unresolved.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT permitted AND EXISTS(
    SELECT 1 FROM ap.legacy_publish_attempts WHERE candidate_id=OLD.id AND stage <> 'safe_failed'
  ) THEN RAISE EXCEPTION 'PUBLICATION_RECONCILIATION_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER candidate_p0_invariants BEFORE INSERT OR UPDATE ON ap.candidate_news
FOR EACH ROW EXECUTE FUNCTION ap_private.guard_candidate_p0();

CREATE FUNCTION ap_private.guard_generation_p0() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RENDER_GENERATION_IMMUTABLE'; END IF;
  IF OLD.status <> 'rendering' OR NEW.render_snapshot IS DISTINCT FROM OLD.render_snapshot
     OR NEW.id <> OLD.id OR NEW.candidate_id <> OLD.candidate_id OR NEW.cliente_id <> OLD.cliente_id
     OR NEW.created_at <> OLD.created_at
     OR (OLD.render_plan IS NOT NULL AND NEW.render_plan IS DISTINCT FROM OLD.render_plan)
     OR (OLD.asset_path IS NOT NULL AND NEW.asset_path IS DISTINCT FROM OLD.asset_path)
     OR (OLD.asset_url IS NOT NULL AND NEW.asset_url IS DISTINCT FROM OLD.asset_url) THEN
    RAISE EXCEPTION 'RENDER_GENERATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER render_generation_immutable BEFORE UPDATE OR DELETE ON ap.render_generations
FOR EACH ROW EXECUTE FUNCTION ap_private.guard_generation_p0();

CREATE OR REPLACE FUNCTION ap.mark_candidate_news_posted(p_candidate_news_id uuid,p_cliente_id uuid)
RETURNS ap.candidate_news LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
  RAISE EXCEPTION 'LOCAL_PUBLICATION_DISABLED_EXTERNAL_CONFIRMATION_REQUIRED' USING ERRCODE='42501';
END $$;

CREATE FUNCTION ap.p0_begin_render(p_candidate_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; generation uuid := gen_random_uuid();
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO c FROM ap.candidate_news WHERE id=p_candidate_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'pending_render' OR c.render_url IS NOT NULL
    OR c.render_started_at > now()-interval '10 minutes' THEN RETURN NULL; END IF;
  UPDATE ap.render_generations SET status='failed',error_code='RENDER_LEASE_EXPIRED',completed_at=now()
    WHERE id=c.current_generation_id AND status='rendering';
  INSERT INTO ap.render_generations(id,candidate_id,cliente_id,status,render_snapshot)
    VALUES(generation,c.id,c.cliente_id,'rendering',to_jsonb(c));
  INSERT INTO ap_private.p0_capabilities VALUES(txid_current(),c.id,'begin_render');
  UPDATE ap.candidate_news SET current_generation_id=generation,render_started_at=clock_timestamp() WHERE id=c.id;
  DELETE FROM ap_private.p0_capabilities WHERE transaction_id=txid_current() AND candidate_id=c.id;
  RETURN jsonb_build_object('generation_id',generation,'candidate',to_jsonb(c));
END $$;

CREATE FUNCTION ap.p0_record_render_plan(p_generation_id uuid,p_plan jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM ap_private.require_p0_worker();
  IF jsonb_typeof(p_plan) <> 'object' OR NULLIF(p_plan->>'templateId','') IS NULL OR p_plan->'layers' IS NULL THEN
    RAISE EXCEPTION 'INVALID_RENDER_PLAN'; END IF;
  UPDATE ap.render_generations SET render_plan=p_plan WHERE id=p_generation_id AND status='rendering' AND render_plan IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'RENDER_PLAN_ALREADY_FROZEN'; END IF;
END $$;

-- Reserve the generation-owned path before uploading. This keeps an orphaned
-- upload traceable without attaching application behavior to Storage internals.
CREATE FUNCTION ap.p0_reserve_render_asset(p_generation_id uuid,p_asset_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; g ap.render_generations;
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO g FROM ap.render_generations WHERE id=p_generation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_RENDER_GENERATION'; END IF;
  SELECT * INTO c FROM ap.candidate_news WHERE id=g.candidate_id FOR UPDATE;
  IF g.status <> 'rendering' OR g.render_plan IS NULL OR g.asset_path IS NOT NULL
     OR c.current_generation_id IS DISTINCT FROM g.id OR c.status <> 'pending_render'
     OR c.render_url IS NOT NULL THEN RAISE EXCEPTION 'RENDER_ASSET_RESERVATION_INVALID'; END IF;
  IF p_asset_path IS NULL OR p_asset_path NOT IN (
    c.cliente_id||'/'||c.id||'/'||g.id||'.png',
    c.cliente_id||'/'||c.id||'/'||g.id||'.jpg'
  ) THEN RAISE EXCEPTION 'INVALID_IMMUTABLE_ASSET_PATH'; END IF;
  UPDATE ap.render_generations SET asset_path=p_asset_path WHERE id=g.id;
END $$;

CREATE FUNCTION ap.p0_complete_render(p_generation_id uuid,p_asset_path text,p_asset_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; g ap.render_generations;
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO g FROM ap.render_generations WHERE id=p_generation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_RENDER_GENERATION'; END IF;
  SELECT * INTO c FROM ap.candidate_news WHERE id=g.candidate_id FOR UPDATE;
  IF g.status <> 'rendering' OR g.render_plan IS NULL OR c.current_generation_id IS DISTINCT FROM g.id
     OR c.status <> 'pending_render' OR c.render_url IS NOT NULL THEN RAISE EXCEPTION 'STALE_RENDER_GENERATION'; END IF;
  IF p_asset_path IS NULL OR p_asset_url IS NULL OR g.asset_path IS DISTINCT FROM p_asset_path
     OR p_asset_url NOT LIKE 'https://%/storage/v1/object/public/ap-renders/'||p_asset_path THEN
    RAISE EXCEPTION 'INVALID_IMMUTABLE_ASSET_PATH'; END IF;
  IF c.territorial_reservation_id IS NOT NULL THEN
    UPDATE ap.territorial_sponsor_reservations SET status='committed',committed_at=COALESCE(committed_at,now())
      WHERE id=c.territorial_reservation_id AND status IN ('reserved','committed');
    IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_RESERVED'; END IF;
  END IF;
  UPDATE ap.render_generations SET status='succeeded',asset_url=p_asset_url,completed_at=now() WHERE id=g.id;
  INSERT INTO ap_private.p0_capabilities VALUES(txid_current(),c.id,'complete_render');
  UPDATE ap.candidate_news SET render_url=p_asset_url,imagem_url=p_asset_url,status='pending_review',
    render_started_at=NULL,render_completed_at=now(),completed_at=now(),error_log=NULL WHERE id=c.id;
  DELETE FROM ap_private.p0_capabilities WHERE transaction_id=txid_current() AND candidate_id=c.id;
END $$;

CREATE FUNCTION ap.p0_fail_render(p_generation_id uuid,p_error_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; g ap.render_generations;
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO g FROM ap.render_generations WHERE id=p_generation_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM ap.candidate_news WHERE id=g.candidate_id FOR UPDATE;
  IF g.status <> 'rendering' OR c.current_generation_id IS DISTINCT FROM g.id THEN RETURN; END IF;
  UPDATE ap.render_generations SET status='failed',error_code=left(p_error_code,120),completed_at=now() WHERE id=g.id;
  UPDATE ap.candidate_news SET status='failed',render_started_at=NULL,error_log=left(p_error_code,120),
    render_attempts=COALESCE(render_attempts,0)+1
    WHERE id=c.id AND status='pending_render';
END $$;

-- Recovery compares the generation AND lease under the same candidate lock.
CREATE FUNCTION ap.p0_expire_render(p_generation_id uuid,p_expected_started_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news;
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO c FROM ap.candidate_news WHERE current_generation_id=p_generation_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'pending_render' OR c.render_started_at IS DISTINCT FROM p_expected_started_at
    OR c.render_started_at IS NULL OR c.render_started_at > now()-interval '15 minutes' THEN RETURN; END IF;
  PERFORM ap.p0_fail_render(p_generation_id,'RENDER_LOCK_EXPIRED');
END $$;

CREATE FUNCTION ap.p0_retry_render(p_candidate_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news;
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO c FROM ap.candidate_news WHERE id=p_candidate_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'failed' OR c.render_url IS NOT NULL OR COALESCE(c.render_attempts,0)>=3
    OR NOT EXISTS(SELECT 1 FROM ap.render_generations WHERE id=c.current_generation_id AND status='failed') THEN
    RAISE EXCEPTION 'RENDER_RETRY_INVALID'; END IF;
  IF c.territorial_reservation_id IS NOT NULL THEN
    -- A correction reuses the already committed composition; never consumes a new sponsor slot.
    UPDATE ap.territorial_sponsor_reservations SET status=CASE WHEN status='committed' THEN status ELSE 'reserved' END,
      reserved_at=CASE WHEN status='committed' THEN reserved_at ELSE now() END,
      released_at=NULL,release_reason=NULL
      WHERE id=c.territorial_reservation_id AND status IN ('released','reserved','committed');
    IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_RETRY_INVALID'; END IF;
  END IF;
  UPDATE ap.candidate_news SET status='pending_render',render_started_at=NULL,error_log=NULL WHERE id=c.id;
END $$;

CREATE FUNCTION ap.p0_approve_generation(p_candidate_id uuid,p_cliente_id uuid,p_generation_id uuid,p_asset_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; actor record;
BEGIN
  SELECT * INTO actor FROM ap.require_editorial_admin_access(p_cliente_id);
  SELECT * INTO c FROM ap.candidate_news WHERE id=p_candidate_id AND cliente_id=p_cliente_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'pending_review' OR c.processing_started_at IS NOT NULL OR c.current_generation_id IS DISTINCT FROM p_generation_id
    OR NOT EXISTS(SELECT 1 FROM ap.render_generations WHERE id=p_generation_id AND candidate_id=c.id
      AND status='succeeded' AND asset_url=p_asset_url AND asset_url=c.render_url) THEN
    RAISE EXCEPTION 'REVIEWED_GENERATION_REQUIRED'; END IF;
  INSERT INTO ap_private.p0_capabilities VALUES(txid_current(),c.id,'approve');
  UPDATE ap.candidate_news SET status='approved',approved_generation_id=p_generation_id,
    approved_by=actor.user_id,approved_by_name=actor.display_name,approved_at=now() WHERE id=c.id;
  DELETE FROM ap_private.p0_capabilities WHERE transaction_id=txid_current() AND candidate_id=c.id;
END $$;

CREATE FUNCTION ap.p0_request_correction(p_candidate_id uuid,p_cliente_id uuid,p_asset_url text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; draft jsonb;
BEGIN
  PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
  SELECT * INTO c FROM ap.candidate_news WHERE id=p_candidate_id AND cliente_id=p_cliente_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'pending_review' OR c.render_url IS NULL OR c.render_url IS DISTINCT FROM p_asset_url
     OR NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'CORRECTION_INVALID_STATE'; END IF;
  -- Historical URLs are preserved as observed, never certified as generation snapshots.
  IF c.current_generation_id IS NULL THEN
    INSERT INTO ap.render_generations(candidate_id,cliente_id,status,render_snapshot,asset_url)
      VALUES(c.id,c.cliente_id,'legacy_observed',jsonb_build_object('provenance','observed_at_correction','candidate',to_jsonb(c)),c.render_url);
  END IF;
  draft := jsonb_build_object('headline',COALESCE(c.headline,c.titulo,''),'caption',COALESCE(c.caption,c.conteudo,''),
    'source_image',COALESCE(c.render_snapshot#>>'{render_content,source_image_url}',
      (SELECT render_snapshot->>'imagem_url' FROM ap.render_generations WHERE id=c.current_generation_id),''),
    'reason',btrim(p_reason),'requested_by',auth.uid(),'requested_at',clock_timestamp());
  INSERT INTO ap_private.p0_capabilities VALUES(txid_current(),c.id,'request_correction');
  UPDATE ap.candidate_news SET status='changes_requested',correction_draft=draft WHERE id=c.id;
  DELETE FROM ap_private.p0_capabilities WHERE transaction_id=txid_current() AND candidate_id=c.id;
END $$;

CREATE FUNCTION ap.p0_submit_correction(p_candidate_id uuid,p_cliente_id uuid,p_expected_draft jsonb,p_headline text,p_caption text,p_source_image text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; snapshot jsonb;
BEGIN
  PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
  SELECT * INTO c FROM ap.candidate_news WHERE id=p_candidate_id AND cliente_id=p_cliente_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'changes_requested' OR c.correction_draft IS NULL
     OR c.correction_draft IS DISTINCT FROM p_expected_draft THEN RAISE EXCEPTION 'CORRECTION_CONFLICT'; END IF;
  IF length(btrim(COALESCE(p_headline,''))) < 2 OR length(btrim(COALESCE(p_caption,''))) < 5 THEN RAISE EXCEPTION 'EDITORIAL_INPUT_REQUIRED'; END IF;
  IF NULLIF(p_source_image,'') IS NOT NULL AND p_source_image !~ '^https?://' THEN RAISE EXCEPTION 'INVALID_SOURCE_IMAGE'; END IF;
  IF c.content_type='feed' AND NULLIF(p_source_image,'') IS NULL THEN RAISE EXCEPTION 'SOURCE_IMAGE_REQUIRED'; END IF;
  snapshot := c.render_snapshot;
  IF snapshot ? 'render_content' THEN
    snapshot := jsonb_set(snapshot,'{render_content}',(snapshot->'render_content') || jsonb_build_object(
      'headline',btrim(p_headline),'caption',btrim(p_caption),'source_image_url',NULLIF(p_source_image,'')));
  END IF;
  INSERT INTO ap_private.p0_capabilities VALUES(txid_current(),c.id,'start_correction');
  UPDATE ap.candidate_news SET titulo=btrim(p_headline),headline=btrim(p_headline),conteudo=btrim(p_caption),caption=btrim(p_caption),
    imagem_url=NULLIF(p_source_image,''),imagem_storage=NULL,render_snapshot=snapshot,
    render_url=NULL,current_generation_id=NULL,approved_generation_id=NULL,approved_by=NULL,approved_by_name=NULL,approved_at=NULL,
    correction_draft=NULL,status='pending_render',render_started_at=NULL,render_completed_at=NULL,completed_at=NULL,
    processing_started_at=NULL,worker_id=NULL,render_attempts=0,error_log=NULL WHERE id=c.id;
  DELETE FROM ap_private.p0_capabilities WHERE transaction_id=txid_current() AND candidate_id=c.id;
END $$;

-- Exclude unresolved attempts before LIMIT, so one ambiguous item cannot starve the queue.
CREATE FUNCTION ap.p0_list_publish_candidates(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,caption text,render_url text,cliente_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM ap_private.require_p0_worker();
  RETURN QUERY SELECT c.id,c.caption,c.render_url,c.cliente_id FROM ap.candidate_news c
    JOIN ap.render_generations g ON g.id=c.approved_generation_id AND g.candidate_id=c.id
    WHERE c.status='approved' AND c.content_type='feed' AND c.instagram_post_id IS NULL
      AND c.horario_agendado<=now() AND c.current_generation_id=c.approved_generation_id
      AND g.status='succeeded' AND g.asset_url=c.render_url
      AND NOT EXISTS(SELECT 1 FROM ap.legacy_publish_attempts a WHERE a.candidate_id=c.id AND a.stage<>'safe_failed')
    ORDER BY c.horario_agendado,c.id LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),50);
END $$;

CREATE FUNCTION ap.p0_claim_publication(p_candidate_id uuid,p_account_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c ap.candidate_news; attempt uuid := gen_random_uuid();
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO c FROM ap.candidate_news WHERE id=p_candidate_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR c.status <> 'approved' OR c.content_type <> 'feed' OR c.instagram_post_id IS NOT NULL
    OR c.horario_agendado IS NULL OR c.horario_agendado>now()
    OR c.current_generation_id IS DISTINCT FROM c.approved_generation_id
    OR NOT EXISTS(SELECT 1 FROM ap.render_generations WHERE id=c.approved_generation_id AND status='succeeded' AND asset_url=c.render_url)
    OR EXISTS(SELECT 1 FROM ap.legacy_publish_attempts WHERE candidate_id=c.id AND stage<>'safe_failed') THEN RETURN NULL; END IF;
  INSERT INTO ap.legacy_publish_attempts(id,candidate_id,generation_id,account_id,stage)
    VALUES(attempt,c.id,c.approved_generation_id,p_account_id,'claimed');
  RETURN jsonb_build_object('attempt_id',attempt,'render_url',c.render_url,'caption',c.caption);
END $$;

CREATE FUNCTION ap.p0_advance_publication(p_attempt_id uuid,p_expected_stage text,p_next_stage text,p_container_id text DEFAULT NULL,p_external_id text DEFAULT NULL,p_error_code text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a ap.legacy_publish_attempts;
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO a FROM ap.legacy_publish_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR a.stage IS DISTINCT FROM p_expected_stage OR p_next_stage IS NULL THEN RAISE EXCEPTION 'PUBLICATION_ATTEMPT_CONFLICT'; END IF;
  IF NOT ((a.stage='claimed' AND p_next_stage IN ('container_created','safe_failed','reconciliation_required'))
    OR (a.stage='container_created' AND p_next_stage IN ('publishing','reconciliation_required'))
    OR (a.stage='publishing' AND p_next_stage IN ('confirmed','reconciliation_required'))) THEN RAISE EXCEPTION 'PUBLICATION_INVALID_TRANSITION'; END IF;
  IF p_next_stage='container_created' AND COALESCE(p_container_id,'') !~ '^[0-9]{1,100}$' THEN RAISE EXCEPTION 'CONTAINER_ID_REQUIRED'; END IF;
  IF p_next_stage='confirmed' AND COALESCE(p_external_id,'') !~ '^[0-9]{1,100}$' THEN RAISE EXCEPTION 'EXTERNAL_MEDIA_ID_REQUIRED'; END IF;
  IF (p_container_id IS NOT NULL AND p_next_stage <> 'container_created')
    OR (p_external_id IS NOT NULL AND p_next_stage <> 'confirmed') THEN RAISE EXCEPTION 'PUBLICATION_EVIDENCE_STAGE_INVALID'; END IF;
  UPDATE ap.legacy_publish_attempts SET stage=p_next_stage,container_id=COALESCE(p_container_id,container_id),
    external_media_id=COALESCE(p_external_id,external_media_id),error_code=left(p_error_code,120),updated_at=now() WHERE id=a.id;
END $$;

CREATE FUNCTION ap.p0_finish_publication(p_attempt_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a ap.legacy_publish_attempts; c ap.candidate_news;
BEGIN
  PERFORM ap_private.require_p0_worker();
  SELECT * INTO a FROM ap.legacy_publish_attempts WHERE id=p_attempt_id;
  IF a.stage IS DISTINCT FROM 'confirmed' OR COALESCE(a.external_media_id,'') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'EXTERNAL_CONFIRMATION_REQUIRED'; END IF;
  SELECT * INTO c FROM ap.candidate_news WHERE id=a.candidate_id FOR UPDATE;
  IF c.status='posted' AND c.instagram_post_id=a.external_media_id THEN RETURN; END IF;
  IF c.status <> 'approved' OR c.approved_generation_id IS DISTINCT FROM a.generation_id THEN RAISE EXCEPTION 'PUBLICATION_RECONCILIATION_REQUIRED'; END IF;
  INSERT INTO ap_private.p0_capabilities VALUES(txid_current(),c.id,'finish_publication');
  UPDATE ap.candidate_news SET status='posted',instagram_post_id=a.external_media_id,published_at=now(),completed_at=now(),
    processing_started_at=NULL,worker_id=NULL WHERE id=c.id;
  DELETE FROM ap_private.p0_capabilities WHERE transaction_id=txid_current() AND candidate_id=c.id;
END $$;

-- Explicit grants: service clients cannot forge journals or generation rows directly.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ap_private FROM PUBLIC,anon,authenticated,service_role;
DO $grants$
DECLARE f record;
BEGIN
 FOR f IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='ap'::regnamespace AND proname = ANY(ARRAY[
   'p0_begin_render','p0_record_render_plan','p0_reserve_render_asset','p0_complete_render','p0_fail_render','p0_expire_render','p0_retry_render',
   'p0_approve_generation','p0_request_correction','p0_submit_correction','p0_list_publish_candidates','p0_claim_publication','p0_advance_publication','p0_finish_publication']) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f.signature,
     CASE WHEN f.proname IN ('p0_approve_generation','p0_request_correction','p0_submit_correction') THEN 'authenticated' ELSE 'service_role' END);
 END LOOP;
END $grants$;

COMMIT;
