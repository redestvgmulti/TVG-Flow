-- 1. Vault Restriction
REVOKE EXECUTE ON FUNCTION public.get_decrypted_secret(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_decrypted_secret(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_decrypted_secret(uuid) TO service_role;

-- 2. Atomic Token Reservation (Race Condition Fix)
CREATE OR REPLACE FUNCTION ap.reserve_editorial_tokens(p_cliente_id uuid, p_tokens int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limit ap.editorial_limits;
BEGIN
  -- Monthly reset check before increment
  UPDATE ap.editorial_limits
  SET monthly_token_used = 0, last_reset_date = CURRENT_DATE
  WHERE cliente_id = p_cliente_id AND DATE_TRUNC('month', last_reset_date) != DATE_TRUNC('month', CURRENT_DATE);

  -- Atomic reservation
  UPDATE ap.editorial_limits
  SET monthly_token_used = monthly_token_used + p_tokens,
      updated_at = now()
  WHERE cliente_id = p_cliente_id
  AND monthly_token_used + p_tokens <= monthly_token_limit
  RETURNING * INTO v_limit;

  IF FOUND THEN
      RETURN TRUE;
  ELSE
      -- Special case: if there is NO limits record at all, we allow it (or we could insert one).
      -- Let's check if the record exists at all.
      IF NOT EXISTS (SELECT 1 FROM ap.editorial_limits WHERE cliente_id = p_cliente_id) THEN
          RETURN TRUE;
      END IF;
      RETURN FALSE;
  END IF;
END;
$$;

-- Refund for unused tokens after actual usage is known
CREATE OR REPLACE FUNCTION ap.refund_editorial_tokens(p_cliente_id uuid, p_tokens_to_refund int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE ap.editorial_limits
  SET monthly_token_used = GREATEST(monthly_token_used - p_tokens_to_refund, 0),
      updated_at = now()
  WHERE cliente_id = p_cliente_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ap.reserve_editorial_tokens(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION ap.refund_editorial_tokens(uuid, int) TO service_role;
