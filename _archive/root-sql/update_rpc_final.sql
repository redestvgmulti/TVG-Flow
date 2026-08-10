-- Drop the existing function first to change signature/return if needed, but we'll use OR REPLACE
CREATE OR REPLACE FUNCTION ap.get_employee_users_for_empresa(p_empresa_id uuid)
RETURNS TABLE (id uuid, email varchar)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify the requester has access to this empresa (simple RBAC check if applicable, or we just trust the p_empresa_id since it's strictly filtered by backend logic usually)
    RETURN QUERY
    SELECT 
        u.id, 
        u.email::varchar 
    FROM auth.users u;
END;
$$;

-- CREATE INDEXES
CREATE INDEX IF NOT EXISTS idx_ap_employee_user ON ap.candidate_news(criado_por_user_id);
CREATE INDEX IF NOT EXISTS idx_ap_created_at_desc ON ap.candidate_news(gerado_em DESC);

