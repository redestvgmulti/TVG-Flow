# QA manual — 2B.2.3 Wiring do editor canônico (Admin + Staff)

Escopo: validar o wiring real nas telas de produção, atrás da feature flag
`ap.editorial_feature_flags` (toggle em Configurações → Fluxo editorial).
Sem chamada real a Placid/Instagram/Apify/LLM — o dispatch usa
`ap-editorial-render-dispatch`, que só cria o `candidate_news` e devolve o
render para o cron existente; nada aqui renderiza de fato.

Pré-requisitos: um tenant de teste com um admin e pelo menos um staff; acesso
ao Supabase SQL Editor ou `supabase db` local para inspecionar
`ap.editorial_articles`/`ap.candidate_news` durante os testes de dispatch.

## Flag OFF

1. Confirmar em Configurações → Fluxo editorial que o toggle está desligado.
2. Admin: clicar "Nova Matéria" → confirmar que abre `ArticleWizard` (fluxo
   antigo), não o editor canônico.
3. Staff: abrir "Criar Matéria Avulsa" → confirmar que abre `ArticleForm`
   (fluxo antigo).
4. Admin/Staff: adotar uma pauta do Banco de Pautas → confirmar que continua
   pré-enchendo o formulário legado e abrindo o modal antigo.

## Flag ON — criação direta

Ligar o toggle em Configurações → Fluxo editorial (como admin do tenant).

5. Admin: "Nova Matéria" → Link → colar URL → Analisar link → confirmar
   preenchimento automático → completar formato/selo → Salvar → Enviar para
   revisão.
6. Admin: "Nova Matéria" → Texto → preencher manualmente → Salvar.
7. Admin: "Nova Matéria" → Imagem → enviar arquivo → confirmar que a origem
   registrada é a URL da imagem enviada → completar e salvar.
8. Repetir 5-7 como Staff via "Criar Matéria Avulsa".

## Flag ON — pauta adotada

9. Adotar uma pauta no Banco de Pautas (admin ou staff) → confirmar que abre
   o editor canônico já com `article_id` preenchido e a badge "Origem: Banco
   de pautas" visível, em vez do formulário legado.
10. Confirmar que a mesma pauta não pode gerar um segundo `editorial_article`
    ativo (tentar adotar novamente deve reutilizar o mesmo artigo, não criar
    outro — `start_editorial_article_from_backlog` já garante isso).

## Revisão completa

11. Staff envia a matéria do passo 5 para revisão.
12. Admin abre Autopublisher → Revisão editorial → confirma que a matéria
    aparece em "Aguardando revisão".
13. Admin clica em "Devolver para correção", preenche um motivo, confirma →
    confirma que a matéria some de "Aguardando revisão" e some o estado
    `changes_requested`.
14. Staff reabre a matéria em Meu Trabalho (categoria "Precisa corrigir") →
    corrige → reenvia para revisão.
15. Admin reabre em "Revisão editorial" → "Aprovar para render" → confirma:
    * toast "Aprovado para render." seguido de "Enviado para renderização.";
    * a matéria passa para "Recentes" (status `dispatched`);
    * uma linha nova aparece em `ap.candidate_news` vinculada
      (`ap.editorial_articles.candidate_news_id` preenchido).

## Falha de dispatch + retry

16. Simular falha (ex.: desconectar a rede momentaneamente logo após clicar
    "Aprovar para render", ou revogar temporariamente a permissão da Edge
    Function) → confirmar:
    * a aprovação editorial NÃO é desfeita (`ap.editorial_articles.status`
      continua `ready_for_render`);
    * mensagem exata "A matéria foi aprovada, mas o envio para renderização
      falhou. Tente novamente." aparece;
    * a matéria continua visível em "Aguardando render" na aba de revisão,
      com o botão "Tentar enviar para render novamente".
17. Clicar novamente em "Tentar enviar para render novamente" com a rede
    normalizada → confirmar sucesso e que **nenhum `candidate_news` duplicado**
    foi criado (`select count(*) from ap.candidate_news where cliente_id = ... and idempotency_key = <article_id>`
    deve retornar 1).
18. Clicar duas vezes rapidamente no botão de aprovar/retry → confirmar que o
    botão fica desabilitado durante a chamada e não duplica candidate.

## Meu Trabalho

19. Confirmar que os itens editoriais aparecem com os rótulos "Em produção",
    "Precisa corrigir", "Em revisão", "Preparando render" ou "Concluído"
    conforme o estado real, e que itens legados mantêm seus rótulos atuais.
20. Confirmar que nenhuma pauta aparece duplicada (uma vez como legado, outra
    como editorial) quando um `editorial_article` já cobre essa pauta.

## Flag OFF depois de já existirem artigos

21. Desligar a flag novamente.
22. Confirmar que os artigos editoriais já criados continuam visíveis e
    operáveis em Meu Trabalho e em Revisão Editorial (nenhum foi apagado ou
    migrado de volta ao legado).
23. Confirmar que "Nova Matéria"/"Criar Matéria Avulsa" voltam a abrir o
    fluxo legado.
