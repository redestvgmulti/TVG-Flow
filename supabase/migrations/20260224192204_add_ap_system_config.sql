CREATE TABLE IF NOT EXISTS ap.system_config (
    cliente_id uuid PRIMARY KEY REFERENCES public.clientes(id) ON DELETE CASCADE,
    ingestion_enabled boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE ap.system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_system_config" ON ap.system_config
    FOR ALL
    TO authenticated
    USING (cliente_id IN (SELECT ap.get_user_cliente_ids()))
    WITH CHECK (cliente_id IN (SELECT ap.get_user_cliente_ids()));

-- Service role access
CREATE POLICY "service_role_system_config" ON ap.system_config
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER trg_system_config_updated
    BEFORE UPDATE ON ap.system_config
    FOR EACH ROW
    EXECUTE FUNCTION ap.touch_updated_at();

-- Upsert initial record for the target client (cd287e6e-f273-4d0f-a72d-2a8c391e40e9) as default true
INSERT INTO ap.system_config (cliente_id, ingestion_enabled)
VALUES ('cd287e6e-f273-4d0f-a72d-2a8c391e40e9', true)
ON CONFLICT (cliente_id) DO NOTHING;
