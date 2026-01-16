# Migration Application Instructions

## Database Migration: 20260115_create_meetings_system.sql

**IMPORTANT**: The migration file is ready but needs to be applied manually via Supabase Studio SQL Editor due to migration history synchronization issues.

## How to Apply:

1. **Open Supabase Studio**
   - Navigate to https://supabase.com/dashboard
   - Select project: "TVG - Flow" (`gyooxmpyxncrezjiljrj`)

2. **Open SQL Editor**
   - Click "SQL Editor" in the left sidebar
   - Click "+ New query"

3. **Copy & Execute Migration**
   - Open: `supabase/migrations/20260115_create_meetings_system.sql`
   - Copy the ENTIRE file contents
   - Paste into Supabase SQL Editor
   - Click "Run" or press `Cmd/Ctrl + Enter`

4. **Verify Migration Success**
   - Check that tables were created:
     ```sql
     SELECT table_name FROM information_schema.tables 
     WHERE table_name IN ('reunioes', 'reunioes_participantes');
     ```
   - Should return 2 rows

5. **Verify RLS Policies**
   ```sql
   SELECT policyname, tablename FROM pg_policies 
   WHERE tablename IN ('reunioes', 'reunioes_participantes');
   ```
   - Should return multiple policies

6. **Verify Functions**
   ```sql
   SELECT proname FROM pg_proc 
   WHERE proname IN ('get_upcoming_meeting_notifications', 'create_meeting_notification');
   ```
   - Should return 2 functions

## What the Migration Creates:

- ✅ `reunioes` table (meetings)
- ✅ `reunioes_participantes` table (meeting participants)
- ✅ Indexes for performance
- ✅ RLS policies (admin/staff access control)
- ✅ Helper functions (`is_admin_in_empresa`, `is_meeting_participant`)
- ✅ Notification RPCs (60min, 30min, 10min reminders)
- ✅ Realtime subscriptions
- ✅ Table/column comments

## After Migration:

Once migration is applied successfully, the following will work:
- Frontend can create/list meetings via `meetingService.js`
- Meetings will appear in calendar for admin/staff
- Notifications will be ready (needs scheduler setup separately)
