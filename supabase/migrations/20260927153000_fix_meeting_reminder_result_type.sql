-- The RPC declares minutes_until_start as integer. EXTRACT returns numeric,
-- which caused PostgreSQL error 42804 whenever the reminder worker invoked it.
CREATE OR REPLACE FUNCTION public.get_upcoming_meeting_notifications(interval_minutes integer)
RETURNS TABLE(
  reuniao_id uuid,
  profissional_id uuid,
  profissional_nome text,
  titulo text,
  data_inicio timestamp with time zone,
  minutes_until_start integer,
  notification_interval integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'ap', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id AS reuniao_id,
    rp.profissional_id,
    p.nome AS profissional_nome,
    r.titulo,
    r.data_inicio,
    FLOOR(EXTRACT(EPOCH FROM (r.data_inicio - NOW())) / 60)::integer AS minutes_until_start,
    interval_minutes AS notification_interval
  FROM public.reunioes AS r
  INNER JOIN public.reunioes_participantes AS rp ON r.id = rp.reuniao_id
  INNER JOIN public.profissionais AS p ON rp.profissional_id = p.id
  WHERE r.status = 'scheduled'
    AND r.data_inicio > NOW()
    AND r.data_inicio <= NOW() + MAKE_INTERVAL(mins => interval_minutes)
    AND r.data_inicio >= NOW() + MAKE_INTERVAL(mins => interval_minutes - 5)
    AND NOT EXISTS (
      SELECT 1
      FROM public.notificacoes AS n
      WHERE n.profissional_id = rp.profissional_id
        AND n.tipo = 'meeting_reminder'
        AND n.metadata->>'reuniao_id' = r.id::text
        AND n.metadata->>'interval_minutes' = interval_minutes::text
        AND n.created_at > NOW() - INTERVAL '2 hours'
    )
  ORDER BY r.data_inicio ASC;
END;
$$;
