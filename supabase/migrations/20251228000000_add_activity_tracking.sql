-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TVG Flow - Add Activity Tracking to Profissionais
-- Enables real-time user activity monitoring for System Status
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add last_activity_at column to track user activity
ALTER TABLE profissionais 
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for efficient active user queries
CREATE INDEX IF NOT EXISTS idx_profissionais_last_activity 
ON profissionais(last_activity_at) 
WHERE ativo = true;

-- Update existing users to have current timestamp
UPDATE profissionais 
SET last_activity_at = NOW() 
WHERE last_activity_at IS NULL;

-- Add comment
COMMENT ON COLUMN profissionais.last_activity_at IS 'Timestamp of last user activity (login, dashboard access, or significant action)';
