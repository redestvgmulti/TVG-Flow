-- R1 / Migration 2: canonical editorial domain only.
-- No legacy candidate, render, publication or reporting behavior is changed.
BEGIN;

-- PostgreSQL requires an exact unique target for the tenant-consistent
-- composite foreign key below. `id` remains the canonical backlog PK.
ALTER TABLE ap.news_backlog
    ADD CONSTRAINT news_backlog_id_cliente_id_key UNIQUE (id, cliente_id);

CREATE TABLE ap.editorial_articles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL
        REFERENCES public.clientes(id) ON DELETE RESTRICT,
    news_backlog_id uuid NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'editing', 'content_final', 'abandoned')),
    responsible_user_id uuid NOT NULL
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    responsible_name_snapshot text NOT NULL,
    author_user_id uuid
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    author_name_snapshot text,
    finalized_by_user_id uuid
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    finalized_by_name_snapshot text,
    first_finalized_at timestamptz,
    finalized_at timestamptz,
    abandoned_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT editorial_articles_id_cliente_id_key UNIQUE (id, cliente_id),
    CONSTRAINT editorial_articles_backlog_tenant_fkey
        FOREIGN KEY (news_backlog_id, cliente_id)
        REFERENCES ap.news_backlog(id, cliente_id)
        ON DELETE RESTRICT
);

CREATE TABLE ap.editorial_article_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id uuid NOT NULL
        REFERENCES ap.editorial_articles(id) ON DELETE RESTRICT,
    revision_number integer NOT NULL CHECK (revision_number > 0),
    revision_kind text NOT NULL
        CHECK (revision_kind IN ('draft_checkpoint', 'content_final')),
    headline text NOT NULL,
    body text NOT NULL,
    created_by_user_id uuid NOT NULL
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    created_by_name_snapshot text NOT NULL,
    request_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT editorial_article_revisions_article_number_key
        UNIQUE (article_id, revision_number)
);

CREATE UNIQUE INDEX editorial_article_revisions_article_request_key
    ON ap.editorial_article_revisions (article_id, request_id)
    WHERE request_id IS NOT NULL;

CREATE TABLE ap.editorial_article_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id uuid NOT NULL,
    cliente_id uuid NOT NULL,
    actor_user_id uuid
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service')),
    action text NOT NULL CHECK (action IN (
        'article_created',
        'draft_saved',
        'content_finalized',
        'article_reopened',
        'article_abandoned',
        'article_reactivated'
    )),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    request_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT editorial_article_events_actor_user_kind_check
        CHECK (actor_kind = 'service' OR actor_user_id IS NOT NULL),
    CONSTRAINT editorial_article_events_article_tenant_fkey
        FOREIGN KEY (article_id, cliente_id)
        REFERENCES ap.editorial_articles(id, cliente_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX editorial_article_events_article_action_request_key
    ON ap.editorial_article_events (article_id, action, request_id)
    WHERE request_id IS NOT NULL;

CREATE INDEX editorial_articles_tenant_responsible_status_updated_idx
    ON ap.editorial_articles (cliente_id, responsible_user_id, status, updated_at DESC);
CREATE INDEX editorial_articles_tenant_first_finalized_idx
    ON ap.editorial_articles (cliente_id, first_finalized_at DESC)
    WHERE first_finalized_at IS NOT NULL;
CREATE INDEX editorial_article_events_article_created_idx
    ON ap.editorial_article_events (article_id, created_at DESC);

-- Revisions and events are immutable audit records, including for a future
-- SECURITY DEFINER write path. Article state remains mutable only through R3.
CREATE FUNCTION ap.reject_editorial_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    RAISE EXCEPTION 'EDITORIAL_APPEND_ONLY_RECORD'
        USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER editorial_article_revisions_append_only
    BEFORE UPDATE OR DELETE ON ap.editorial_article_revisions
    FOR EACH ROW EXECUTE FUNCTION ap.reject_editorial_append_only_mutation();
CREATE TRIGGER editorial_article_events_append_only
    BEFORE UPDATE OR DELETE ON ap.editorial_article_events
    FOR EACH ROW EXECUTE FUNCTION ap.reject_editorial_append_only_mutation();

ALTER TABLE ap.editorial_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_articles FORCE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_article_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_article_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_article_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_article_events FORCE ROW LEVEL SECURITY;

-- Browser-facing data access is intentionally deferred to R3 RPCs.
REVOKE ALL ON TABLE ap.editorial_articles FROM PUBLIC;
REVOKE ALL ON TABLE ap.editorial_articles FROM anon;
REVOKE ALL ON TABLE ap.editorial_articles FROM authenticated;
REVOKE ALL ON TABLE ap.editorial_articles FROM service_role;
REVOKE ALL ON TABLE ap.editorial_article_revisions FROM PUBLIC;
REVOKE ALL ON TABLE ap.editorial_article_revisions FROM anon;
REVOKE ALL ON TABLE ap.editorial_article_revisions FROM authenticated;
REVOKE ALL ON TABLE ap.editorial_article_revisions FROM service_role;
REVOKE ALL ON TABLE ap.editorial_article_events FROM PUBLIC;
REVOKE ALL ON TABLE ap.editorial_article_events FROM anon;
REVOKE ALL ON TABLE ap.editorial_article_events FROM authenticated;
REVOKE ALL ON TABLE ap.editorial_article_events FROM service_role;

REVOKE ALL ON FUNCTION ap.reject_editorial_append_only_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION ap.reject_editorial_append_only_mutation() FROM anon;
REVOKE ALL ON FUNCTION ap.reject_editorial_append_only_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION ap.reject_editorial_append_only_mutation() FROM service_role;

COMMENT ON TABLE ap.editorial_articles IS
    'Canonical R1 editorial article. It is one-to-one with a tenant-consistent backlog item.';
COMMENT ON TABLE ap.editorial_article_revisions IS
    'Immutable editorial content checkpoints; request_id provides per-article idempotency.';
COMMENT ON TABLE ap.editorial_article_events IS
    'Immutable editorial audit events; request_id provides per-action idempotency.';

COMMIT;
