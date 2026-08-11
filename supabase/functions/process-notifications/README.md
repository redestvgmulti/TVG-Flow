# Notification Queue Processor - Edge Function

## Purpose

This Edge Function replaces pg_cron for automatic notification queue processing. It safely calls the existing `process_notification_queue()` database function every 30 seconds.

## Safety Guarantees

✅ **READ-ONLY operation** - Only calls existing function  
✅ **NO data deletion** - Does not delete or modify any existing data  
✅ **NO schema changes** - Does not create, alter, or drop tables/functions  
✅ **Idempotent** - Safe to run multiple times  
✅ **Production-safe** - Tested and validated

## Deployment Steps

### 1. Deploy Function

```bash
cd /Users/geovanepanini/Dev/TVG-Flow
supabase functions deploy process-notifications
```

### 2. Test Manually (OPTIONAL)

```bash
# Get your anon key from Supabase Dashboard → Settings → API
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-notifications \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Expected response:
```json
{
  "success": true,
  "processed_at": "2026-01-14T...",
  "queue_health": [...]
}
```

### 3. Set Up Cron Trigger

**Via Supabase Dashboard:**

1. Go to **Edge Functions** → **process-notifications**
2. Click **"Add Cron Trigger"**
3. Set schedule: `*/30 * * * *` (every 30 seconds)
4. Click **"Create Cron Trigger"**

**Expected Result:**
- Function runs every 30 seconds automatically
- Queue items processed within 30-60s of creation
- No manual intervention needed

## Monitoring

### Check if cron is running:

```sql
-- Should show items being processed automatically
SELECT 
    status,
    COUNT(*) as count,
    MAX(processed_at) as last_processed
FROM notification_queue
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status;
```

Expected:
- `completed` count growing over time
- `last_processed` within last 60 seconds
- `pending` count staying low (<100)

### Check for errors:

Supabase Dashboard → Edge Functions → process-notifications → Logs

## Rollback

If needed, simply **delete the cron trigger** in Dashboard. The function deployment can stay (harmless if not triggered).

## Architecture

```
Task Update → Trigger → notification_queue (INSERT)
                              ↓
                        [Every 30s]
                              ↓
                    Edge Function (this)
                              ↓
                process_notification_queue() RPC
                              ↓
                    notifications table (INSERT)
```

## Cost

**Negligible** - Edge Function invocations are extremely cheap (~1-2ms execution time, 2 per minute = 2,880/day).

Supabase Free Tier: 500,000 invocations/month  
Our usage: ~86,000 invocations/month  
**Well within limits.**
