-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Push Notifications Subscriptions Table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Table to store Web Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profissional_id, endpoint)
);

-- Index for faster lookups
CREATE INDEX idx_push_subscriptions_profissional ON push_subscriptions(profissional_id);

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
COMMENT ON COLUMN push_subscriptions.endpoint IS 'Push service endpoint URL';
COMMENT ON COLUMN push_subscriptions.p256dh_key IS 'Public key for encryption';
COMMENT ON COLUMN push_subscriptions.auth_key IS 'Authentication secret';
