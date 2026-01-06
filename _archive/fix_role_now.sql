-- Quick fix for null roles
UPDATE profissionais
SET role = 'staff'
WHERE role IS NULL AND email = 'panini@tvgflow.com';

-- Verify
SELECT id, email, nome, role, ativo FROM profissionais WHERE email = 'panini@tvgflow.com';
