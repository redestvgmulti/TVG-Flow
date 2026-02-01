-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FASE 5 - IDENTITY HELPER (FRONTEND SOURCE OF TRUTH)
-- DATE: 2026-01-23
-- DESCRIPTION: Cria a função get_current_identity para ser a ÚNICA
--              fonte de verdade para o AuthContext do frontend.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION public.get_current_identity()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_prof public.profissionais%ROWTYPE;
BEGIN
    -- 1. Buscar profissional pelo ID da sessão (auth.uid())
    SELECT * INTO v_prof
    FROM public.profissionais
    WHERE id = auth.uid();

    IF NOT FOUND THEN
        -- Retorna null ou objeto vazio indicando sem perfil
        RETURN jsonb_build_object(
            'has_profile', false,
            'role', 'anon',
            'id', NULL,
            'nome', NULL
        );
    END IF;

    -- 2. Retornar dados essenciais normalizados
    RETURN jsonb_build_object(
        'has_profile', true,
        'id', v_prof.id,
        'nome', v_prof.nome,
        'email', v_prof.email,
        'role', v_prof.role, -- A ÚNICA fonte de verdade para role
        'ativo', v_prof.ativo
    );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_current_identity() TO authenticated;
