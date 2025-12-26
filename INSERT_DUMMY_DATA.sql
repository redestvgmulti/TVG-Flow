-- Inserir dados fictícios de empresas para testar o dashboard de Super Admin

INSERT INTO public.empresas (nome, status_conta, icp_status, tipo_negocio, last_activity_at) VALUES 
('Agency Flow Ltda', 'active', 'correct', 'agency', NOW()),
('Studio Design X', 'active', 'correct', 'studio', NOW() - INTERVAL '2 days'),
('Produtora Visual', 'suspended', 'doubtful', 'producer', NOW() - INTERVAL '15 days'),
('Tech Solutions', 'trial', 'correct', 'other', NOW() - INTERVAL '5 days'),
('Old Client', 'active', 'wrong', 'agency', NOW() - INTERVAL '30 days');

-- Associar alguns usuários fictícios (se existirem) ou apenas contagem
-- (O RPC conta empresa_profissionais, então para ver contagem precisa de relação)
-- Mas para visualização inicial, criar as empresas é o mais importante.
