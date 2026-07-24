
UPDATE tarefas_micro tm
SET cargo = COALESCE(
  (
    SELECT ep.cargo
    FROM tarefas t
    JOIN empresa_profissionais ep
      ON ep.profissional_id = tm.profissional_id
      AND ep.empresa_id = t.empresa_id
    WHERE t.id = tm.tarefa_id
    LIMIT 1
  ),
  'LEGADO'
);
;
