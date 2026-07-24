
-- UPDATE controlado: usar DISTINCT ON para pegar o primeiro cargo válido
-- dos outros vínculos do profissional (ordenado alfabeticamente para determinismo)
UPDATE empresa_profissionais ep_alvo
SET cargo = sub.cargo_inferido
FROM (
  SELECT DISTINCT ON (ep_sem.id)
    ep_sem.id AS ep_id,
    ep_outro.cargo AS cargo_inferido
  FROM empresa_profissionais ep_sem
  JOIN empresa_profissionais ep_outro
    ON ep_outro.profissional_id = ep_sem.profissional_id
    AND ep_outro.id <> ep_sem.id
    AND ep_outro.cargo IS NOT NULL
    AND ep_outro.cargo NOT IN ('SEM_CARGO','LEGADO')
  WHERE ep_sem.empresa_id = '006ba477-5e61-4d9f-ab55-b29590efe37d'
    AND ep_sem.cargo = 'SEM_CARGO'
  ORDER BY ep_sem.id, ep_outro.cargo
) sub
WHERE ep_alvo.id = sub.ep_id
  AND ep_alvo.cargo = 'SEM_CARGO';
;
