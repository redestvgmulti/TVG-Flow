-- AutoPublisher "Automação" settings — adds operator-configurable controls to
-- ap.system_config for auto-approval, publish quiet hours, daily publish cap
-- and new-batch notifications. All defaults below reproduce today's live
-- behavior exactly (human approval always required, publishing unrestricted
-- by time of day, no daily cap) so this migration changes nothing until an
-- admin opts in from the Configurações screen.
ALTER TABLE ap.system_config
  ADD COLUMN IF NOT EXISTS auto_approve boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_threshold double precision NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS notify_team boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS publish_on_quiet boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_cap integer,
  ADD COLUMN IF NOT EXISTS quiet_start time NOT NULL DEFAULT '23:00',
  ADD COLUMN IF NOT EXISTS quiet_end time NOT NULL DEFAULT '06:00';
