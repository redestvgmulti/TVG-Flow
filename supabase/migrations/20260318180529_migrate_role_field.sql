
UPDATE empresa_profissionais
SET role = LOWER(funcao)
WHERE LOWER(funcao) IN ('membro','staff','admin','administração','administrativo');
;
