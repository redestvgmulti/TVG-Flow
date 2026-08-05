-- This migration follows 20260318171700, which already creates a policy with
-- the same name. The definitions are intentionally different: this version
-- switches micro-task membership to the SECURITY DEFINER helper introduced by
-- 20260318192804. Accept only the known predecessor or this exact target state.
-- Any other homonymous policy is treated as drift and fails closed.
DO $migration$
DECLARE
  current_roles text[];
  current_command text;
  current_permissive text;
  current_using text;
  current_check text;
  predecessor_expression constant text :=
    '(is_admin_safe()oris_super_admin()or(created_by=auth.uid())or(assigned_to=auth.uid())or(exists(select1fromtarefas_microtmwhere((tm.tarefa_id=tarefas.id)and(tm.profissional_id=auth.uid())))))';
  target_expression constant text :=
    '(is_admin_safe()oris_super_admin()or(created_by=auth.uid())oris_user_assigned_to_task(id))';
  policy_state text := 'missing';
BEGIN
  SELECT
    roles::text[],
    cmd,
    permissive,
    lower(regexp_replace(qual, '[[:space:]]+', '', 'g')),
    lower(regexp_replace(with_check, '[[:space:]]+', '', 'g'))
  INTO
    current_roles,
    current_command,
    current_permissive,
    current_using,
    current_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'tarefas'
    AND policyname = 'RLS: admin ou envolvidos podem modificar';

  IF FOUND THEN
    IF current_permissive = 'PERMISSIVE'
       AND current_command = 'ALL'
       AND current_roles = ARRAY['public']::text[]
       AND current_using = target_expression
       AND current_check = target_expression THEN
      policy_state := 'target';
    ELSIF current_permissive = 'PERMISSIVE'
       AND current_command = 'ALL'
       AND current_roles = ARRAY['authenticated']::text[]
       AND current_using = predecessor_expression
       AND current_check = predecessor_expression THEN
      policy_state := 'predecessor';
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'historical OS policy migration found an unexpected definition',
        DETAIL = format(
          'policy=%L roles=%s command=%s permissive=%s using=%s with_check=%s',
          'RLS: admin ou envolvidos podem modificar',
          current_roles,
          current_command,
          current_permissive,
          current_using,
          current_check
        ),
        HINT = 'Inspect the divergent policy; this migration will not overwrite it.';
    END IF;
  END IF;

  -- Preserve the original cleanup, but only after the homonymous policy has
  -- been proven safe. The whole transition remains atomic inside this block.
  EXECUTE 'DROP POLICY IF EXISTS "RLS: modificar apenas envolvidos" ON public.tarefas';
  EXECUTE 'DROP POLICY IF EXISTS "Admins and creators can delete tasks" ON public.tarefas';

  IF policy_state = 'target' THEN
    RETURN;
  END IF;

  IF policy_state = 'predecessor' THEN
    EXECUTE 'DROP POLICY "RLS: admin ou envolvidos podem modificar" ON public.tarefas';
  END IF;

  EXECUTE $policy$
    CREATE POLICY "RLS: admin ou envolvidos podem modificar"
    ON public.tarefas
    FOR ALL
    USING (
      public.is_admin_safe()
      OR public.is_super_admin()
      OR created_by = auth.uid()
      OR public.is_user_assigned_to_task(tarefas.id)
    )
    WITH CHECK (
      public.is_admin_safe()
      OR public.is_super_admin()
      OR created_by = auth.uid()
      OR public.is_user_assigned_to_task(tarefas.id)
    )
  $policy$;
END
$migration$;
