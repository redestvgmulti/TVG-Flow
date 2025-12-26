-- Migration: Super Admin Setup
-- Description: Adds super_admin role, creates empresas table with governance fields, and sets up RLS.

-- 1. Update 'profissionais' role constraint to include 'super_admin'
DO $$ BEGIN
    ALTER TABLE profissionais DROP CONSTRAINT IF EXISTS profissionais_role_check;
    ALTER TABLE profissionais ADD CONSTRAINT profissionais_role_check 
        CHECK (role IN ('admin', 'profissional', 'super_admin'));
EXCEPTION
    WHEN undefined_object THEN
        -- Handle case where constraint name might be different
        NULL;
END $$;

-- 2. Create or Update 'empresas' table
CREATE TABLE IF NOT EXISTS empresas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new governance columns if they don't exist
DO $$ BEGIN
    ALTER TABLE empresas ADD COLUMN IF NOT EXISTS status_conta TEXT DEFAULT 'active' CHECK (status_conta IN ('trial', 'active', 'suspended'));
    ALTER TABLE empresas ADD COLUMN IF NOT EXISTS icp_status TEXT DEFAULT 'doubtful' CHECK (icp_status IN ('correct', 'doubtful', 'wrong'));
    ALTER TABLE empresas ADD COLUMN IF NOT EXISTS internal_notes TEXT;
    ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo_negocio TEXT CHECK (tipo_negocio IN ('agency', 'studio', 'producer', 'other'));
    ALTER TABLE empresas ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- 3. Enable RLS on empresas
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Super Admin: Full Access
CREATE POLICY "Super Admin Full Access" ON empresas
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profissionais
            WHERE profissionais.id = auth.uid()
            AND profissionais.role = 'super_admin'
        )
    );

-- 5. RPC: Get Companies Dashboard Stats
CREATE OR REPLACE FUNCTION get_companies_stats()
RETURNS TABLE (
    empresa_id UUID,
    nome TEXT,
    status_conta TEXT,
    icp_status TEXT,
    tipo_negocio TEXT,
    users_count BIGINT,
    active_tasks_count BIGINT,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    health_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.nome,
        e.status_conta,
        e.icp_status,
        e.tipo_negocio,
        (SELECT COUNT(*) FROM empresa_profissionais ep WHERE ep.empresa_id = e.id) as users_count,
        (SELECT COUNT(*) FROM tarefas t WHERE t.empresa_id = e.id AND t.status IN ('pending', 'in_progress')) as active_tasks_count,
        e.last_activity_at,
        CASE
            WHEN e.last_activity_at > NOW() - INTERVAL '7 days' THEN 'healthy'
            WHEN e.last_activity_at > NOW() - INTERVAL '14 days' THEN 'low_activity'
            ELSE 'inactive'
        END as health_status
    FROM empresas e;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. RPC: Toggle Suspension (Strict Block Helper)
-- No special Helper needed if Frontend uses standard Update, but good to have specific function if logic is complex.
-- Sticking to RLS + Standard Update for now as per plan.

