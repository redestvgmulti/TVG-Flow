-- Migration: Add get_my_cliente_id RPC (Safe Version)
-- Descrição: Permite que o frontend resolva o cliente_id do profissional autenticado.

CREATE OR REPLACE FUNCTION public.get_my_cliente_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cliente_id UUID;
  v_role TEXT;
  v_empresa_id UUID;
BEGIN
  -- 1. Tentar vínculo DIRETO (Standard Employee mode)
  SELECT cliente_id
  INTO v_cliente_id
  FROM public.cliente_profissionais
  WHERE profissional_id = auth.uid()
    AND ativo = true
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_cliente_id IS NOT NULL THEN
    RETURN v_cliente_id;
  END IF;

  -- 2. Tentar busca via Tenant para Admins/Masters
  SELECT role INTO v_role FROM public.profissionais WHERE id = auth.uid();

  -- Se não encontrou role (usuário sem perfil de profissional)
  IF v_role IS NULL THEN
     RAISE EXCEPTION 'Usuário % sem perfil de profissional cadastrado.', auth.uid();
  END IF;

  IF v_role IN ('admin', 'super_admin', 'master_admin') THEN
    -- Tentar o tenant (empresa) vinculado
    SELECT empresa_id INTO v_empresa_id
    FROM public.empresa_profissionais
    WHERE profissional_id = auth.uid()
      AND ativo = true
    LIMIT 1;

    IF v_empresa_id IS NOT NULL THEN
      SELECT id INTO v_cliente_id
      FROM public.clientes
      WHERE empresa_id = v_empresa_id
        AND ativo = true
      ORDER BY created_at ASC
      LIMIT 1;
      
      IF v_cliente_id IS NOT NULL THEN
        RETURN v_cliente_id;
      END IF;
    END IF;

    -- 3. Fallback Final para Admins: Pegar o primeiro cliente ativo do sistema
    -- Garante que o sistema nunca trave para administradores master
    SELECT id INTO v_cliente_id
    FROM public.clientes
    WHERE ativo = true
    ORDER BY created_at ASC
    LIMIT 1;
    
    IF v_cliente_id IS NOT NULL THEN
      RETURN v_cliente_id;
    END IF;
  END IF;

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum cliente_id ativo encontrado para o usuário %. Role: %', auth.uid(), v_role;
  END IF;

  RETURN v_cliente_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_my_cliente_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_cliente_id() TO service_role;
