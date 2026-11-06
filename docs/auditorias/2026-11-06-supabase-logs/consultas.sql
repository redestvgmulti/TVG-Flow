-- Logs: ClickHouse SQL, via Management API /analytics/endpoints/logs.
-- Janela: 2026-11-06T11:00:00Z a 2026-11-06T12:00:00Z.
-- Nao executar estas consultas no Postgres: a tabela logs pertence ao servico de logs.

select source, count() as total from logs group by source order by total desc;

select event_message,
       log_attributes['parsed.error_severity'] as severity,
       log_attributes['parsed.sql_state_code'] as sqlstate,
       log_attributes['parsed.context'] as context,
       count() as total, min(timestamp) as first_at, max(timestamp) as last_at
from logs where source='postgres_logs'
group by event_message, severity, sqlstate, context order by total desc;

select log_attributes['parsed.session_id'] as session,
       log_attributes['parsed.process_id'] as pid,
       count() as total, min(timestamp) as first_at, max(timestamp) as last_at,
       uniqExact(log_attributes['parsed.transaction_id']) as distinct_transactions
from logs where source='postgres_logs' and event_message='EDITORIAL_REVISION_CONFLICT'
group by session,pid;

-- Repetir a consulta acima com a janela ampliada de 24h para medir persistencia.
-- O limite de consulta nao estabelece o inicio/fim real do incidente.

select source, log_attributes['level'] as level,
       log_attributes['parsed.error_severity'] as severity,
       log_attributes['response.status_code'] as status, count() as total
from logs group by source,level,severity,status order by source,total desc;

-- Banco: PostgreSQL, somente leitura.

select pid, application_name, usename, state, backend_start,
       xact_start, query_start, state_change, wait_event_type, wait_event
from pg_catalog.pg_stat_activity
where application_name='postgrest'
  and (query ilike '%save_editorial_article_draft%' or state <> 'idle')
order by query_start;

select n.nspname as schema_name, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='ap' and p.prokind='f'
  and pg_catalog.pg_get_functiondef(p.oid) like '%EDITORIAL_REVISION_CONFLICT%';
