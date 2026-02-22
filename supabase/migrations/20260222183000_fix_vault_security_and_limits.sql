-- ═══════════════════════════════════════════════════════════════
-- PATCH P0: Vault Security + Atomic Token Limits
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Garantir existência da função e DEPOIS restringir acesso ──

-- Cria (ou recria) a função que descriptografa segredos do Vault
CREATE OR REPLACE FUNCTION public.get_decrypted_secret(secret_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  secret_text text;
BEGIN
  SELECT decrypted_secret INTO secret_text
  FROM vault.decrypted_secrets
  WHERE id = secret_id;
  RETURN secret_text;
END;
$$;

-- Agora que existe, revogar de todos e conceder somente ao service_role
REVOKE EXECUTE ON FUNCTION public.get_decrypted_secret(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_decrypted_secret(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_decrypted_secret(uuid) TO   service_role;

-- ── 2. Funções de reserva atômica de tokens (Race Condition Fix) ──

-- Reserva tokens de forma atômica (pré-billing + reset mensal embutido)
CREATE OR REPLACE FUNCTION ap.reserve_editorial_tokens(p_cliente_id uuid, p_tokens int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Reset mensal automático (se já virou o mês)
  UPDATE ap.editorial_limits
  SET monthly_token_used = 0,
      last_reset_date    = CURRENT_DATE
  WHERE cliente_id = p_cliente_id
    AND DATE_TRUNC('month', last_reset_date::date) != DATE_TRUNC('month', CURRENT_DATE);

  -- Tentativa de reserva atômica
  UPDATE ap.editorial_limits
  SET monthly_token_used = monthly_token_used + p_tokens,
      updated_at         = now()
  WHERE cliente_id              = p_cliente_id
    AND monthly_token_used + p_tokens <= monthly_token_limit;

  IF FOUND THEN
    RETURN TRUE;
  END IF;

  -- Se não existe nenhum registro de limites para o tenant, permite (sem restrição)
  IF NOT EXISTS (SELECT 1 FROM ap.editorial_limits WHERE cliente_id = p_cliente_id) THEN
    RETURN TRUE;
  END IF;

  -- Limite atingido
  RETURN FALSE;
END;
$$;

-- Estorno de tokens após retorno real da OpenAI
CREATE OR REPLACE FUNCTION ap.refund_editorial_tokens(p_cliente_id uuid, p_tokens_to_refund int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE ap.editorial_limits
  SET monthly_token_used = GREATEST(monthly_token_used - p_tokens_to_refund, 0),
      updated_at         = now()
  WHERE cliente_id = p_cliente_id;
END;
$$;

-- Permissões para service_role apenas
GRANT EXECUTE ON FUNCTION ap.reserve_editorial_tokens(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION ap.refund_editorial_tokens(uuid, int) TO service_role;
