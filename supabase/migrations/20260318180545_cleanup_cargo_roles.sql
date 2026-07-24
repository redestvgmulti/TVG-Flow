
-- Limpar qualquer cargo que tenha sobrado com valores de role
UPDATE empresa_profissionais
SET cargo = NULL
WHERE TRIM(UPPER(cargo)) IN ('MEMBRO','STAFF','ADMIN','ADMINISTRAÇÃO','ADMINISTRATIVO');
;
