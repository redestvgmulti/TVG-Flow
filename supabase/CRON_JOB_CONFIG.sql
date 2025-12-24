-- ============================================
-- CRON JOB: Hourly Overdue Notifications
-- Configure no Supabase Dashboard
-- ============================================

-- PASSO 1: Vá para Database > Cron Jobs
-- PASSO 2: Clique em "Create a new cron job"
-- PASSO 3: Configure:

-- Nome: notify-overdue-tasks-hourly
-- Schedule: 0 * * * *
-- SQL Command (copie abaixo):

SELECT
  net.http_post(
      url:='https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/notify-overdue-tasks',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQzNDcxMTYsImV4cCI6MjA0OTkyMzExNn0.Ux7qVJJPjHJGdODnqkJEGqLxSPLBJVxlBqwGVDnOPLk"}'::jsonb,
      body:='{}'::jsonb
  ) as request_id;

-- PASSO 4: Clique em "Create"

-- ============================================
-- TESTE MANUAL (opcional)
-- ============================================

-- Execute este SQL para testar manualmente:
SELECT
  net.http_post(
      url:='https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/notify-overdue-tasks',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQzNDcxMTYsImV4cCI6MjA0OTkyMzExNn0.Ux7qVJJPjHJGdODnqkJEGqLxSPLBJVxlBqwGVDnOPLk"}'::jsonb,
      body:='{}'::jsonb
  ) as request_id;
