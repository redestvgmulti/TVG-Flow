-- Fix: Add missing UPDATE policy for push_subscriptions
-- This is required for upsert operations to work correctly

-- Users can update their own subscriptions
CREATE POLICY "Users update own subscriptions"
ON push_subscriptions FOR UPDATE
TO authenticated
USING (profissional_id = auth.uid())
WITH CHECK (profissional_id = auth.uid());
