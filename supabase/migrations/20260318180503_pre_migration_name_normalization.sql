
-- Normalizar JOAO → JOÃO e CINTIA → CÍNTIA
UPDATE empresa_profissionais
SET funcao = 'JOÃO'
WHERE funcao = 'JOAO';

UPDATE empresa_profissionais
SET funcao = 'CÍNTIA'
WHERE funcao = 'CINTIA';

-- MICHELE e MICHELLE são tratados como NOMES PUROS → ambos virarão SEM_CARGO na migração de cargo
-- Não unificar agora pois podem ser pessoas diferentes
;
