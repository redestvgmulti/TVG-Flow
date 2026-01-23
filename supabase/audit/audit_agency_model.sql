/*
 * AUDITORIA DE COMPORTAMENTO MULTI-TENANT (AGENCY MODEL)
 * 
 * Instruções:
 * 1. Substitua <MF_VIDROS_ID> pelo ID da empresa 'MF Vidros' (Tenant).
 * 2. Substitua <ADMIN_USER_ID> pelo UUID do usuário Admin da 'MF Vidros'.
 * 3. Execute este script no Editor SQL do Supabase.
 * 
 * Observação: Para simular o usuário corretamente, usamos `set local role authenticated`
 * e injetamos o UUID no claim JWT.
 */

BEGIN;

-- 🔹 CONFIGURAÇÃO DE SIMULAÇÃO (Preencha aqui)
-- =================================================================
-- Define o contexto da transação como se fosse o usuário logado
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claim.sub" = '<ADMIN_USER_ID>';
-- =================================================================

DO $$
DECLARE
    v_current_role text;
    v_empresa_id uuid;
    v_can_create boolean;
    v_count integer;
    
    -- IDs para o teste (Substitua se necessário para variáveis locais)
    target_tenant_id uuid := '<MF_VIDROS_ID>';
    target_tvg_id uuid := '<TVG_ID>'; -- ID de um outro tenant para teste de isolamento
    client_x_id uuid := '<CLIENTE_X_ID>'; -- ID de um cliente (empresa atendida)
    
BEGIN
    RAISE NOTICE '=== INÍCIO DA AUDITORIA ===';

    -- 🔹 FASE 1: Identidade e Papel
    RAISE NOTICE '>> Fase 1: Identidade';
    
    -- Checa identidade via RPC oficial
    SELECT (public.get_current_identity()).role INTO v_current_role;
    
    IF v_current_role = 'admin' THEN
        RAISE NOTICE '✅ [PASS] Role identificada corretamente como: %', v_current_role;
    ELSE
        RAISE NOTICE '❌ [FAIL] Role incorreta: % (Esperado: admin)', v_current_role;
    END IF;

    -- 🔹 FASE 2: Vínculo com Tenant
    RAISE NOTICE '>> Fase 2: Vínculo com Tenant';
    
    SELECT count(*) INTO v_count 
    FROM public.empresa_profissionais 
    WHERE profissional_id = cast(current_setting('request.jwt.claim.sub', true) as uuid)
      AND empresa_id = target_tenant_id
      AND ativo = true;

    IF v_count = 1 THEN
        RAISE NOTICE '✅ [PASS] Vínculo único com tenant confirmado.';
    ELSE
        RAISE NOTICE '❌ [FAIL] Vínculo incorreto ou múltiplo (Count: %)', v_count;
    END IF;
    
    -- 🔹 FASE 3: Visibilidade de Empresas (RPC)
    RAISE NOTICE '>> Fase 3: Visibilidade';
    
    -- Teste 3.1: Pode ver própria empresa
    IF public.can_view_empresa(target_tenant_id) THEN
        RAISE NOTICE '✅ [PASS] Admin pode ver sua empresa (MF Vidros).';
    ELSE
        RAISE NOTICE '❌ [FAIL] Admin NÃO consegue ver sua própria empresa.';
    END IF;

    -- Teste 3.2: Pode ver empresa alheia? (TVG - Opcional se TVG_ID fornecido)
    -- IF public.can_view_empresa(target_tvg_id) THEN
    --    RAISE NOTICE '❌ [FAIL] VAZAMENTO: Admin pode ver TVG!';
    -- ELSE
    --    RAISE NOTICE '✅ [PASS] Isolamento confirmado: Admin não vê TVG.';
    -- END IF;

    -- 🔹 FASE 6: Criação de OS (Capability Check)
    RAISE NOTICE '>> Fase 6: Criação de OS';

    -- Teste 6.1: Pode criar para seu cliente?
    -- (Necessário ter criado o cliente antes ou ter ID válido)
    -- select public.can_create_os(target_tenant_id, client_x_id) returning boolean...
    -- Simulação simplificada de capability geral:
    
    -- 🔹 FASE 7: Isolamento Total (Consulta)
    RAISE NOTICE '>> Fase 7: Isolamento de Leitura (RLS)';
    
    SELECT count(*) INTO v_count FROM public.empresas;
    RAISE NOTICE 'ℹ️ O usuário vê % empresa(s) na listagem geral.', v_count;
    
    IF v_count = 1 THEN 
        RAISE NOTICE '✅ [PASS] RLS Isolou listagem (vê apenas a sua ou clientes).';
    ELSE
        RAISE NOTICE '⚠️ [INFO] Verifique se as empresas listadas pertencem ao tenant (% empresas).', v_count;
    END IF;

    RAISE NOTICE '=== FIM DA AUDITORIA ===';
    
END $$;

ROLLBACK; -- Reverte para não deixar estado sujo se fizesse inserts
