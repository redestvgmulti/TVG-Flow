-- Trigger functions are internal implementation details, never public RPCs.
REVOKE ALL ON FUNCTION public.set_task_creator_attribution()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_meeting_creator_attribution()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION ap.set_candidate_creator_attribution()
FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the caller's RLS context when the public Data API views read the
-- tenant-scoped ap.candidate_news table.
ALTER VIEW public.ap_candidate_news
    SET (security_invoker = true);

ALTER VIEW public.ap_candidate_news_complete
    SET (security_invoker = true);
