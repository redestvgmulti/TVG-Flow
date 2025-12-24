-- ============================================
-- CRIAR CRON JOB PARA NOTIFICAÇÕES DE ATRASO
-- Execute este SQL no Supabase SQL Editor
-- ============================================

-- 1. Criar o cron job
SELECT cron.schedule(
    'notify-overdue-tasks-hourly',  -- Nome do job
    '0 * * * *',                     -- Schedule: a cada hora no minuto 0
    $$
    SELECT net.http_post(
        url:='https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/notify-overdue-tasks',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQzNDcxMTYsImV4cCI6MjA0OTkyMzExNn0.Ux7qVJJPjHJGdODnqkJEGqLxSPLBJVxlBqwGVDnOPLk"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);

-- 2. Verificar se foi criado
SELECT 
    jobid,
    schedule,
    command,
    active,
    jobname
FROM cron.job
WHERE jobname = 'notify-overdue-tasks-hourly';

-- 3. Listar todos os cron jobs (opcional)
SELECT 
    jobid,
    schedule,
    active,
    jobname
FROM cron.job
ORDER BY jobid DESC;

-- ============================================
-- TESTE MANUAL (OPCIONAL)
-- Execute para testar sem esperar 1 hora
-- ============================================

SELECT net.http_post(
    url:='https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/notify-overdue-tasks',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQzNDcxMTYsImV4cCI6MjA0OTkyMzExNn0.Ux7qVJJPjHJGdODnqkJEGqLxSPLBJVxlBqwGVDnOPLk"}'::jsonb,
    body:='{}'::jsonb
) as request_id;

-- Verificar se notificações foram criadas
SELECT * FROM notifications 
WHERE type = 'task_overdue' 
ORDER BY created_at DESC 
LIMIT 5;

-- ============================================
-- REMOVER CRON JOB (se necessário)
-- ============================================

-- SELECT cron.unschedule('notify-overdue-tasks-hourly');
