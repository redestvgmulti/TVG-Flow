-- ensure_profissional_on_auth_user() (base schema 20260223031956) inserts into
-- public.profissionais without a nome, but profissionais.nome is NOT NULL, so
-- every auth signup that reaches this trigger aborts with a not-null violation.
-- Replace the function (without touching the applied base migration) so nome is
-- always populated from a safe fallback chain, preserving all other fields and
-- the ON CONFLICT DO NOTHING behavior.

CREATE OR REPLACE FUNCTION public.ensure_profissional_on_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profissionais (id, nome, email, role, ativo)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Usuário'
    ),
    NEW.email,
    'staff',
    true
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;
