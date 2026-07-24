
-- Corrigir: ADMINISTRATIVO - PRISCILA deve ter cargo = 'ADMINISTRATIVO', role = NULL
UPDATE empresa_profissionais
SET cargo = 'ADMINISTRATIVO', role = NULL
WHERE funcao = 'ADMINISTRATIVO - PRISCILA';

-- Normalizar roles variantes → padrão simples
UPDATE empresa_profissionais
SET role = 'admin'
WHERE role IN ('administração', 'administrativo');
;
