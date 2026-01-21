SELECT empresa_id, profissional_id, COUNT(*) FROM empresa_profissionais GROUP BY empresa_id, profissional_id HAVING COUNT(*) > 1;
