-- Migration: Create get_agencia_cliente_id RPC
-- Description: Resolves the agency's own client ID for AutoPublisher Employee Mode.

CREATE OR REPLACE FUNCTION public.get_agencia_cliente_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cliente_id UUID;
BEGIN

  SELECT id
  INTO v_cliente_id
  FROM public.clientes
  WHERE tipo = 'agencia'
  AND ativo = true
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION
      'Nenhum cliente da agência encontrado na tabela clientes';
  END IF;

  RETURN v_cliente_id;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_agencia_cliente_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agencia_cliente_id() TO service_role;
