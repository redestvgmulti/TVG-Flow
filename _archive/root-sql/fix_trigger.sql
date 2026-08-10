CREATE OR REPLACE FUNCTION "public"."ensure_profissional_on_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_nome TEXT;
BEGIN
  -- Try to get the name from metadata, fallback to email prefix, or default
  v_nome := COALESCE(
    NEW.raw_user_meta_data->>'nome',
    split_part(NEW.email, '@', 1),
    'Novo Profissional'
  );

  INSERT INTO profissionais (id, email, nome, role, ativo)
  VALUES (NEW.id, NEW.email, v_nome, 'staff', true)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
