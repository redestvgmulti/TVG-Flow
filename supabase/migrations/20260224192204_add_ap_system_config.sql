CREATE TABLE IF NOT EXISTS ap.system_config (
    cliente_id uuid PRIMARY KEY
        REFERENCES public.clientes(id)
        ON DELETE CASCADE,
    ingestion_enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ap.system_config
    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_system_config
    ON ap.system_config;

CREATE POLICY tenant_isolation_system_config
    ON ap.system_config
    FOR ALL
    TO authenticated
    USING (
        cliente_id IN (
            SELECT ap.get_user_cliente_ids()
        )
    )
    WITH CHECK (
        cliente_id IN (
            SELECT ap.get_user_cliente_ids()
        )
    );

DROP POLICY IF EXISTS service_role_system_config
    ON ap.system_config;

CREATE POLICY service_role_system_config
    ON ap.system_config
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_system_config_updated
    ON ap.system_config;

CREATE TRIGGER trg_system_config_updated
    BEFORE UPDATE
    ON ap.system_config
    FOR EACH ROW
    EXECUTE FUNCTION ap.touch_updated_at();

-- Seed only when the target tenant already exists.
-- This keeps fresh local databases replayable without production tenant data.
INSERT INTO ap.system_config (
    cliente_id,
    ingestion_enabled
)
SELECT
    clientes.id,
    true
FROM public.clientes AS clientes
WHERE clientes.id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
ON CONFLICT (cliente_id) DO NOTHING;
