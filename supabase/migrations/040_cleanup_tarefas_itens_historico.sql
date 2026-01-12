-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION 040: CLEANUP - Remove orphaned tarefas_itens_historico
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Clean up orphaned historical table and function from removed tarefas_itens
-- ISSUE: tarefas_itens was removed in migration 039, but tarefas_itens_historico still exists
-- FIX: Drop historical table and associated function
-- 
-- SAFETY: 100% production-safe
-- - These tables are not used by the application
-- - tarefas_micro uses tarefas_micro_logs for audit trail (different system)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Drop trigger function
DROP FUNCTION IF EXISTS log_tarefas_itens_changes() CASCADE;

-- Drop historical table
DROP TABLE IF EXISTS tarefas_itens_historico CASCADE;

-- Note: tarefas_micro uses tarefas_micro_logs for audit trail (already exists)
