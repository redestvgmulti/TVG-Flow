-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HARDENING 004: Storage Multi-Tenant RLS
-- Migration: 044_hardening_storage_rls.sql  
-- Priority: HIGH
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PROBLEMA:
-- Storage RLS valida empresa_id via path mas não valida se usuário tem
-- acesso à tarefa específica. Usuário pode acessar anexos de outra tarefa
-- da mesma empresa sem estar envolvido nela.
--
-- SOLUÇÃO:
-- Refinar RLS para validar tarefa_id via JOIN com tarefas_micro ou
-- verificação de is_os_participant.
--
-- IMPACTO:
-- Mais restritivo (seguro). Usuários só acessam anexos de tarefas onde
-- estão envolvidos (assigned ou micro-task).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. DROP EXISTING POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP POLICY IF EXISTS "Company members can view attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to company folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own uploads" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete company uploads" ON storage.objects;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CREATE HARDENED SELECT POLICY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE POLICY "Task participants can view attachments"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'task-attachments' AND
    auth.role() = 'authenticated' AND
    (
        -- Admin bypassa validação (vê tudo da empresa)
        EXISTS (
            SELECT 1 FROM profissionais p
            INNER JOIN empresa_profissionais ep ON ep.profissional_id = p.id
            WHERE p.id = auth.uid()
            AND p.role = 'admin'
            AND ep.empresa_id::text = (storage.foldername(name))[1]
        )
        OR
        -- Staff: validar participação na tarefa específica
        EXISTS (
            SELECT 1 FROM tarefas t
            WHERE t.id::text = (storage.foldername(name))[2] -- tarefa_id
            AND (
                -- Criador da tarefa
                t.created_by = auth.uid()
                OR
                -- Atribuído à tarefa (assigned_to)
                t.assigned_to = auth.uid()
                OR
                -- Tem micro-task na tarefa
                EXISTS (
                    SELECT 1 FROM tarefas_micro tm
                    WHERE tm.tarefa_id = t.id
                    AND tm.profissional_id = auth.uid()
                )
            )
        )
    )
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. CREATE HARDENED INSERT POLICY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE POLICY "Task participants can upload attachments"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'task-attachments' AND
    auth.role() = 'authenticated' AND
    (
        -- Admin pode fazer upload em qualquer tarefa da empresa
        EXISTS (
            SELECT 1 FROM profissionais p
            INNER JOIN empresa_profissionais ep ON ep.profissional_id = p.id
            WHERE p.id = auth.uid()
            AND p.role = 'admin'
            AND ep.empresa_id::text = (storage.foldername(name))[1]
        )
        OR
        -- Staff: validar participação na tarefa
        EXISTS (
            SELECT 1 FROM tarefas t
            WHERE t.id::text = (storage.foldername(name))[2]
            AND (
                t.created_by = auth.uid()
                OR t.assigned_to = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM tarefas_micro tm
                    WHERE tm.tarefa_id = t.id
                    AND tm.profissional_id = auth.uid()
                )
            )
        )
    )
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. CREATE HARDENED DELETE POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Policy 1: Usuário pode deletar próprios uploads
CREATE POLICY "Users can delete own uploads"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'task-attachments' AND
    auth.uid() = owner
);

-- Policy 2: Admin pode deletar qualquer upload da empresa
CREATE POLICY "Admins can delete company uploads"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'task-attachments' AND
    auth.role() = 'authenticated' AND
    EXISTS (
        SELECT 1 FROM profissionais p
        INNER JOIN empresa_profissionais ep ON ep.profissional_id = p.id
        WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND ep.empresa_id::text = (storage.foldername(name))[1]
    )
);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. ROLLBACK INSTRUCTIONS (if needed)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- Restaurar policies originais executando:
-- /Users/geovanepanini/Dev/FlowOS/supabase/migrations/034_storage_bucket.sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

