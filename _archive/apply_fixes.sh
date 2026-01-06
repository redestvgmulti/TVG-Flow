#!/bin/bash
# Script para aplicar todas as correções críticas

echo "🔧 Aplicando correções críticas do TVG Flow..."

# 1. Aplicar migrations via Supabase
echo "📦 Aplicando migrations..."
cd "$(dirname "$0")"

# Aplicar migration de correção de status
echo "  → Corrigindo mismatch de status (P6 - CRÍTICO)"
supabase db push

# 2. Deploy Edge Functions atualizadas
echo "📡 Fazendo deploy das Edge Functions..."
supabase functions deploy create-os-by-function
supabase functions deploy notify-overdue-tasks

# 3. Executar auditoria de integridade
echo "🔍 Executando auditoria de integridade..."
echo "Execute manualmente no Supabase SQL Editor: supabase/AUDIT_DATABASE.sql"

echo "✅ Correções aplicadas com sucesso!"
echo ""
echo "⚠️  PRÓXIMOS PASSOS MANUAIS:"
echo "1. Executar AUDIT_DATABASE.sql no Supabase SQL Editor"
echo "2. Configurar cron job para notify-overdue-tasks"
echo "3. Testar criação de OS end-to-end"
echo "4. Verificar console do navegador"
