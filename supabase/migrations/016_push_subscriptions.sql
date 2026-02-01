-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Push Notifications Subscriptions Table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Table to store Web Push subscriptions (compatible with old schema)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add new columns if they don't exist (migration from old JSONB schema)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'push_subscriptions' AND column_name = 'endpoint') THEN
    ALTER TABLE push_subscriptions
    ADD COLUMN endpoint TEXT,
    ADD COLUMN p256dh_key TEXT,
    ADD COLUMN auth_key TEXT;
  END IF;
  
  -- Add unique constraint if not exists
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_profissional_id_endpoint_key') THEN
    ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_profissional_id_endpoint_key UNIQUE(profissional_id, endpoint);
  END IF;
END$$;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profissional ON push_subscriptions(profissional_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RLS POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their own subscriptions
CREATE POLICY "Users view own subscriptions"
ON push_subscriptions FOR SELECT
TO authenticated
USING (profissional_id = auth.uid());

-- Users can insert their own subscriptions
CREATE POLICY "Users insert own subscriptions"
ON push_subscriptions FOR INSERT
TO authenticated
WITH CHECK (profissional_id = auth.uid());

-- Users can delete their own subscriptions
CREATE POLICY "Users delete own subscriptions"
ON push_subscriptions FOR DELETE
TO authenticated
USING (profissional_id = auth.uid());

-- Service role can read all (for Edge Function)
CREATE POLICY "Service role read all"
ON push_subscriptions FOR SELECT
TO service_role
USING (true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE push_subscriptions IS 'Web Push notification subscriptions for users';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'push_subscriptions' AND column_name = 'endpoint') THEN
    COMMENT ON COLUMN push_subscriptions.endpoint IS 'Push service endpoint URL';
    COMMENT ON COLUMN push_subscriptions.p256dh_key IS 'Public key for encryption';
    COMMENT ON COLUMN push_subscriptions.auth_key IS 'Authentication secret';
  END IF;
END$$;
