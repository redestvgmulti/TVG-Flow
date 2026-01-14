-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HARDENING 003: Circular Dependency Prevention
-- Migration: 043_hardening_prevent_cycles.sql
-- Priority: HIGH
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PROBLEMA:
-- Campo depends_on em tarefas_micro permite ciclos (A→B→C→A), travando workflow.
-- Sem validação, um erro de lógica pode criar deadlock permanente.
--
-- SOLUÇÃO:
-- Trigger que detecta ciclos antes de INSERT/UPDATE usando traversal recursivo.
-- Também valida que dependência pertence à mesma tarefa pai.
--
-- IMPACTO:
-- Zero breaking changes. Apenas previne estados inválidos que travam sistema.
-- Dados existentes não são afetados (trigger não valida retroativamente).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. CREATE CYCLE DETECTION FUNCTION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION prevent_dependency_cycle()
RETURNS TRIGGER AS $$
DECLARE
    v_visited UUID[] := ARRAY[]::UUID[];
    v_current UUID;
    v_depth INTEGER := 0;
    v_max_depth CONSTANT INTEGER := 100;
    v_parent_tarefa_id UUID;
BEGIN
    -- Se não há dependência, permitir
    IF NEW.depends_on IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- VALIDAÇÃO 1: Não pode depender de si mesmo
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    IF NEW.id = NEW.depends_on THEN
        RAISE EXCEPTION 'Micro-task não pode depender de si mesma'
            USING HINT = 'depends_on deve ser diferente de id';
    END IF;
    
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- VALIDAÇÃO 2: Dependência deve ser da mesma tarefa pai
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    SELECT tarefa_id INTO v_parent_tarefa_id
    FROM tarefas_micro
    WHERE id = NEW.depends_on;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dependência não encontrada: %', NEW.depends_on
            USING HINT = 'depends_on deve referenciar micro-task existente';
    END IF;
    
    IF v_parent_tarefa_id != NEW.tarefa_id THEN
        RAISE EXCEPTION 'Dependência deve ser de micro-task da mesma tarefa pai'
            USING HINT = format('Tarefa pai esperada: %s, encontrada: %s', 
                NEW.tarefa_id, v_parent_tarefa_id);
    END IF;
    
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- VALIDAÇÃO 3: Detectar ciclo via graph traversal
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    -- Iniciar com o nó atual
    v_visited := array_append(v_visited, NEW.id);
    v_current := NEW.depends_on;
    
    -- Traversal recursivo
    WHILE v_current IS NOT NULL AND v_depth < v_max_depth LOOP
        -- Ciclo direto detectado (volta ao nó inicial)
        IF v_current = NEW.id THEN
            RAISE EXCEPTION 'Dependência circular detectada: criar esta dependência formaria um ciclo'
                USING HINT = format('Caminho: %s → ... → %s', NEW.id, v_current),
                      DETAIL = format('Cadeia visitada: %s', array_to_string(v_visited, ' → '));
        END IF;
        
        -- Ciclo indireto detectado (revisita nó intermediário)
        IF v_current = ANY(v_visited) THEN
            RAISE EXCEPTION 'Dependência circular detectada (ciclo indireto)'
                USING HINT = format('Nó %s já foi visitado na cadeia', v_current),
                      DETAIL = format('Cadeia visitada: %s', array_to_string(v_visited, ' → '));
        END IF;
        
        -- Adicionar à lista de visitados
        v_visited := array_append(v_visited, v_current);
        
        -- Próximo nó na cadeia
        SELECT depends_on INTO v_current
        FROM tarefas_micro
        WHERE id = v_current;
        
        v_depth := v_depth + 1;
    END LOOP;
    
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- VALIDAÇÃO 4: Limite de profundidade (proteção contra bugs)
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    IF v_depth >= v_max_depth THEN
        RAISE EXCEPTION 'Cadeia de dependências muito longa (máximo: % níveis)', v_max_depth
            USING HINT = 'Simplifique a estrutura de dependências ou contate suporte';
    END IF;
    
    -- Tudo OK, permitir operação
    RETURN NEW;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Re-raise com informações adicionais
        RAISE EXCEPTION 'Validação de dependências falhou: %', SQLERRM
            USING HINT = 'Verifique se a estrutura de dependências está correta';
END;
$$ LANGUAGE plpgsql;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CREATE TRIGGER
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP TRIGGER IF EXISTS trigger_prevent_dependency_cycle ON tarefas_micro;

CREATE TRIGGER trigger_prevent_dependency_cycle
    BEFORE INSERT OR UPDATE OF depends_on ON tarefas_micro
    FOR EACH ROW
    WHEN (NEW.depends_on IS NOT NULL)
    EXECUTE FUNCTION prevent_dependency_cycle();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. COMMENTS & DOCUMENTATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON FUNCTION prevent_dependency_cycle() IS 
'Hardening: Previne dependências circulares em tarefas_micro.
Valida que depends_on não cria ciclos (A→B→C→A) e pertence à mesma tarefa pai.
Limite: 100 níveis de profundidade.';

COMMENT ON TRIGGER trigger_prevent_dependency_cycle ON tarefas_micro IS 
'Hardening: Executa validação de ciclos antes de INSERT/UPDATE de depends_on.
Previne deadlocks permanentes no workflow.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. VERIFICAÇÃO DE DADOS EXISTENTES (opcional)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Query: Detectar possíveis ciclos em dados existentes (não bloqueia migration)
-- Executar manualmente se necessário:
--
-- WITH RECURSIVE dependency_chain AS (
--     SELECT id, depends_on, tarefa_id, ARRAY[id] as path, 0 as depth
--     FROM tarefas_micro
--     WHERE depends_on IS NOT NULL
--     
--     UNION ALL
--     
--     SELECT tm.id, tm.depends_on, tm.tarefa_id, 
--            dc.path || tm.id, dc.depth + 1
--     FROM tarefas_micro tm
--     INNER JOIN dependency_chain dc ON tm.id = dc.depends_on
--     WHERE tm.id = ANY(dc.path) = FALSE AND dc.depth < 100
-- )
-- SELECT * FROM dependency_chain WHERE depends_on = ANY(path)
-- ORDER BY tarefa_id, depth;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. ROLLBACK INSTRUCTIONS (if needed)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- DROP TRIGGER IF EXISTS trigger_prevent_dependency_cycle ON tarefas_micro;
-- DROP FUNCTION IF EXISTS prevent_dependency_cycle();
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
