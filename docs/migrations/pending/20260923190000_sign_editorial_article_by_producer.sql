-- Keep the byline tied to the person who adopted and produced the pauta.
-- An administrator may finalize an article on their behalf; that action is
-- recorded separately in finalized_by_user_id.
BEGIN;

CREATE FUNCTION ap.sign_editorial_article_by_producer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF NEW.status = 'content_final' AND OLD.status IS DISTINCT FROM NEW.status THEN
        NEW.author_user_id := NEW.responsible_user_id;
        NEW.author_name_snapshot := NEW.responsible_name_snapshot;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER editorial_article_producer_signature
BEFORE UPDATE OF status ON ap.editorial_articles
FOR EACH ROW EXECUTE FUNCTION ap.sign_editorial_article_by_producer();

COMMIT;
