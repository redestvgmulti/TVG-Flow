-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: GRANT EXECUTE ON OS RPCs
-- DATE: 2026-01-23
-- DESCRIPTION: Explicitly grants execute permissions to authenticated users.
-- Fixes 404 error when calling update_os/cancel_os via API.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GRANT EXECUTE ON FUNCTION update_os(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_os(UUID) TO authenticated, service_role;
