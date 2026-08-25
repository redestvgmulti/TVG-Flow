-- Autoatendimento da tela "Meu Perfil": telefone, foto, senha (via Supabase
-- Auth, sem tabela própria) e preferências de notificação. A revogação de
-- UPDATE/INSERT/DELETE de "authenticated" em profissionais (migration
-- 20260816120000) bloqueou qualquer escrita direta nessa tabela, então as
-- duas RPCs abaixo são o único caminho para o próprio usuário alterar seus
-- dados — sempre restritas a auth.uid(), nunca tocam role/ativo/email.

ALTER TABLE public.profissionais ADD COLUMN IF NOT EXISTS telefone text;
ALTER TABLE public.profissionais ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prof public.profissionais%ROWTYPE;
    v_dept_nome text;
    v_dept_cor text;
    v_empresa_nome text;
BEGIN
    SELECT * INTO v_prof FROM public.profissionais WHERE id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('has_profile', false);
    END IF;

    IF v_prof.departamento_id IS NOT NULL THEN
        SELECT d.nome, d.cor_hex INTO v_dept_nome, v_dept_cor
        FROM public.departamentos d
        WHERE d.id = v_prof.departamento_id;
    END IF;

    SELECT e.nome INTO v_empresa_nome
    FROM public.empresa_profissionais ep
    JOIN public.empresas e ON e.id = ep.empresa_id
    WHERE ep.profissional_id = v_prof.id
      AND ep.ativo = true
      AND e.ativo = true
      AND e.empresa_tipo = 'tenant'
    ORDER BY ep.created_at ASC
    LIMIT 1;

    RETURN jsonb_build_object(
        'has_profile', true,
        'id', v_prof.id,
        'nome', v_prof.nome,
        'email', v_prof.email,
        'telefone', v_prof.telefone,
        'avatar_url', v_prof.avatar_url,
        'role', v_prof.role,
        'ativo', v_prof.ativo,
        'created_at', v_prof.created_at,
        'departamento_nome', v_dept_nome,
        'departamento_cor', v_dept_cor,
        'empresa_nome', v_empresa_nome
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

COMMENT ON FUNCTION public.get_my_profile() IS
    'Retorna o perfil completo do usuário autenticado (inclui telefone/avatar/departamento/empresa), contornando a política de SELECT restrita a colegas do mesmo tenant.';

CREATE OR REPLACE FUNCTION public.update_my_profile(p_nome text, p_telefone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prof public.profissionais%ROWTYPE;
    v_nome text := trim(coalesce(p_nome, ''));
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;

    IF v_nome = '' THEN
        RAISE EXCEPTION 'INVALID_NAME';
    END IF;

    IF char_length(v_nome) > 160 THEN
        RAISE EXCEPTION 'NAME_TOO_LONG';
    END IF;

    IF char_length(trim(coalesce(p_telefone, ''))) > 40 THEN
        RAISE EXCEPTION 'PHONE_TOO_LONG';
    END IF;

    UPDATE public.profissionais
       SET nome = v_nome,
           telefone = NULLIF(trim(coalesce(p_telefone, '')), '')
     WHERE id = auth.uid()
     RETURNING * INTO v_prof;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFILE_NOT_FOUND';
    END IF;

    RETURN jsonb_build_object('id', v_prof.id, 'nome', v_prof.nome, 'telefone', v_prof.telefone);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated;

COMMENT ON FUNCTION public.update_my_profile(text, text) IS
    'Atualiza nome e telefone do próprio usuário autenticado. Nunca toca role/ativo/email — esses seguem server-managed.';

CREATE OR REPLACE FUNCTION public.update_my_avatar(p_avatar_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prof public.profissionais%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;

    UPDATE public.profissionais
       SET avatar_url = NULLIF(trim(coalesce(p_avatar_url, '')), '')
     WHERE id = auth.uid()
     RETURNING * INTO v_prof;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROFILE_NOT_FOUND';
    END IF;

    RETURN jsonb_build_object('id', v_prof.id, 'avatar_url', v_prof.avatar_url);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_avatar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_avatar(text) TO authenticated;

COMMENT ON FUNCTION public.update_my_avatar(text) IS
    'Atualiza a foto de perfil (avatar_url) do próprio usuário autenticado, após upload no bucket avatars.';

-- Preferências de notificação (uma linha por profissional).

CREATE TABLE IF NOT EXISTS public.preferencias_notificacao (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profissional_id uuid NOT NULL UNIQUE REFERENCES public.profissionais(id) ON DELETE CASCADE,
    notif_tarefa_atribuida boolean NOT NULL DEFAULT true,
    notif_prazo boolean NOT NULL DEFAULT true,
    notif_reuniao boolean NOT NULL DEFAULT true,
    notif_materia_publicada boolean NOT NULL DEFAULT false,
    digest_frequencia text NOT NULL DEFAULT 'diario' CHECK (digest_frequencia IN ('diario', 'semanal', 'nenhum')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.preferencias_notificacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preferencias_notificacao_select_own ON public.preferencias_notificacao;
DROP POLICY IF EXISTS preferencias_notificacao_insert_own ON public.preferencias_notificacao;
DROP POLICY IF EXISTS preferencias_notificacao_update_own ON public.preferencias_notificacao;

CREATE POLICY preferencias_notificacao_select_own ON public.preferencias_notificacao
    FOR SELECT TO authenticated USING (profissional_id = auth.uid());

CREATE POLICY preferencias_notificacao_insert_own ON public.preferencias_notificacao
    FOR INSERT TO authenticated WITH CHECK (profissional_id = auth.uid());

CREATE POLICY preferencias_notificacao_update_own ON public.preferencias_notificacao
    FOR UPDATE TO authenticated USING (profissional_id = auth.uid()) WITH CHECK (profissional_id = auth.uid());

REVOKE ALL ON TABLE public.preferencias_notificacao FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.preferencias_notificacao TO authenticated;

DROP TRIGGER IF EXISTS trigger_update_preferencias_notificacao_updated_at ON public.preferencias_notificacao;
CREATE TRIGGER trigger_update_preferencias_notificacao_updated_at
    BEFORE UPDATE ON public.preferencias_notificacao
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Bucket de avatares: leitura pública, escrita restrita à própria pasta
-- (convenção de path: "{auth.uid()}/arquivo.ext").

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;

CREATE POLICY "avatars_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_owner_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_owner_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Make the additive RPC/table contract visible to PostgREST immediately after
-- deployment instead of waiting for its schema-cache refresh interval.
NOTIFY pgrst, 'reload schema';
