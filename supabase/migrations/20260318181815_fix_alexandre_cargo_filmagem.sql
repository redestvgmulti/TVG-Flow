
-- Corrigir Alexandre: FILMAGEM → FILMAGEM / FOTO (cargo dominante real, 5x vs 1x)
UPDATE empresa_profissionais
SET cargo = 'FILMAGEM / FOTO'
WHERE profissional_id = 'c48385d9-4186-4f95-a470-0bc60b6bd6e3'
  AND cargo = 'FILMAGEM'
  AND empresa_id = '006ba477-5e61-4d9f-ab55-b29590efe37d';
;
