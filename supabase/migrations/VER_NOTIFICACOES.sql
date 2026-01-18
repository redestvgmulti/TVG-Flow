-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QUERY FINAL: VER NOTIFICAÇÕES CRIADAS E SEUS DETALHES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    n.id,
    n.tipo,
    n.titulo,
    n.mensagem,
    p.nome as profissional_nome,
    p.email as profissional_email,
    n.metadata->>'reuniao_id' as reuniao_id,
    n.metadata->>'titulo' as titulo_reuniao,
    n.lida,
    n.created_at
FROM notificacoes n
JOIN profissionais p ON p.id = n.profissional_id
WHERE n.tipo = 'meeting_created'
AND n.created_at > NOW() - INTERVAL '10 minutes'
ORDER BY n.created_at DESC;
