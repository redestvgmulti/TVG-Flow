-- 1. Ensure policies exist for Admin on tarefas_micro
DROP POLICY IF EXISTS "Admin tem acesso total a tarefas_micro" ON tarefas_micro;

CREATE POLICY "Admin tem acesso total a tarefas_micro"
  ON tarefas_micro FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profissionais
      WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profissionais
      WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
    )
  );

-- 2. Ensure policies exist for Admin on tarefas_micro_logs
DROP POLICY IF EXISTS "Admin tem acesso total a tarefas_micro_logs" ON tarefas_micro_logs;

CREATE POLICY "Admin tem acesso total a tarefas_micro_logs"
  ON tarefas_micro_logs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profissionais
      WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profissionais
      WHERE id = auth.uid()
      AND role = 'admin'
      AND ativo = true
    )
  );
