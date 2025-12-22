-- Migration: Create tarefas_itens_historico (audit trail for micro-tasks)
-- Description: Immutable audit log for all micro-task changes for accountability and traceability

CREATE TABLE IF NOT EXISTS tarefas_itens_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tarefa_item_id UUID NOT NULL,
    tarefa_id UUID NOT NULL,
    profissional_id UUID NOT NULL,
    acao VARCHAR(50) NOT NULL, -- 'criado', 'concluido', 'reaberto', 'atualizado'
    status_anterior VARCHAR(20),
    status_novo VARCHAR(20),
    usuario_id UUID REFERENCES usuarios(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for audit queries
CREATE INDEX idx_tarefas_itens_historico_item ON tarefas_itens_historico(tarefa_item_id);
CREATE INDEX idx_tarefas_itens_historico_tarefa ON tarefas_itens_historico(tarefa_id);
CREATE INDEX idx_tarefas_itens_historico_profissional ON tarefas_itens_historico(profissional_id);
CREATE INDEX idx_tarefas_itens_historico_created_at ON tarefas_itens_historico(created_at DESC);

-- Trigger function to log all micro-task changes
CREATE OR REPLACE FUNCTION log_tarefas_itens_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO tarefas_itens_historico (
            tarefa_item_id, 
            tarefa_id, 
            profissional_id, 
            acao, 
            status_novo, 
            usuario_id
        ) VALUES (
            NEW.id, 
            NEW.tarefa_id, 
            NEW.profissional_id, 
            'criado', 
            NEW.status, 
            auth.uid()
        );
        
    ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        INSERT INTO tarefas_itens_historico (
            tarefa_item_id, 
            tarefa_id, 
            profissional_id, 
            acao, 
            status_anterior, 
            status_novo, 
            usuario_id
        ) VALUES (
            NEW.id, 
            NEW.tarefa_id, 
            NEW.profissional_id,
            CASE 
                WHEN NEW.status = 'concluida' THEN 'concluido'
                WHEN NEW.status = 'pendente' AND OLD.status = 'concluida' THEN 'reaberto'
                ELSE 'atualizado'
            END,
            OLD.status, 
            NEW.status, 
            auth.uid()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_log_tarefas_itens_changes
    AFTER INSERT OR UPDATE ON tarefas_itens
    FOR EACH ROW
    EXECUTE FUNCTION log_tarefas_itens_changes();

-- Enable RLS
ALTER TABLE tarefas_itens_historico ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admin can view all audit logs
CREATE POLICY "Admin can view all micro-task audit logs"
    ON tarefas_itens_historico
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM usuarios
            WHERE usuarios.id = auth.uid()
            AND usuarios.tipo_perfil = 'admin'
        )
    );

-- RLS Policy: Professionals can view their own audit logs
CREATE POLICY "Professionals can view their micro-task audit logs"
    ON tarefas_itens_historico
    FOR SELECT
    TO authenticated
    USING (profissional_id = auth.uid());

-- RLS Policy: No one can modify audit logs (immutable)
-- (No INSERT/UPDATE/DELETE policies = read-only except via trigger)

-- Comments
COMMENT ON TABLE tarefas_itens_historico IS 'Immutable audit trail for all micro-task changes';
COMMENT ON COLUMN tarefas_itens_historico.acao IS 'Action performed: criado, concluido, reaberto, atualizado';
COMMENT ON COLUMN tarefas_itens_historico.usuario_id IS 'User who performed the action';
COMMENT ON FUNCTION log_tarefas_itens_changes() IS 'Automatically logs all micro-task changes to audit trail';
