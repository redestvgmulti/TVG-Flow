# QA manual — 2B.2.2 Editor editorial canônico

Escopo: validar `CanonicalEditorialEditor` isoladamente, via a rota de
desenvolvimento `/dev/editorial-editor` (só existe em `npm run dev`, removida
do bundle de produção por `import.meta.env.DEV`). Não cobre wiring em telas
reais (2B.2.3), nem o disparo do handoff para o P0 (2B.2.1, já validado em
`tests/migrations/2b2-editorial-render-dispatch-contract.test.mjs`).

Pré-requisitos: `ap.editorial_feature_flags.editorial_workflow_v1_enabled =
true` para o cliente de teste (`SELECT ap.set_editorial_workflow_v1_enabled(true)`
logado como admin do tenant); um usuário staff e um admin no mesmo tenant.

## 1. Criar — Link
1. Abrir `/dev/editorial-editor` com "Simular admin" desmarcado, campo de
   article_id vazio, clicar Abrir.
2. Selecionar origem "Link", colar uma URL válida, clicar "Analisar link".
3. Confirmar que manchete/corpo foram preenchidos a partir do scraper.
4. Editar o texto, preencher formato/selo, clicar Salvar.
5. Confirmar toast "Rascunho salvo." e que o artigo passou a existir (debug
   JSON mostra `id`, `status: editing`).

## 2. Criar — Texto
1. Novo artigo, origem "Texto". Confirmar que nenhum campo de URL aparece.
2. Preencher manchete/corpo manualmente, formato/selo, Salvar.

## 3. Criar — Imagem
1. Novo artigo, origem "Imagem". Confirmar que aparece um dropzone (não um
   campo de URL) na seção Origem.
2. Enviar uma imagem; confirmar que o upload conclui e que a badge de origem
   (após salvar) mostra "Imagem enviada diretamente".
3. Preencher manchete/corpo/formato, Salvar.

## 4. Abrir artigo de pauta (Banco de Pautas)
1. Criar manualmente um artigo via `ap.start_editorial_article_from_backlog`
   contra um item existente do banco de pautas (ou usar um já existente).
2. Abrir esse `article_id` na rota de dev, passando o contexto de
   `originBacklog` (ajustar o harness ou inspecionar via debug JSON).
3. Confirmar que a seção Origem não aparece como editável (sem os 3 botões de
   origem) e que a proveniência do banco de pautas fica visível.

## 5. Salvar rascunho
1. Com um artigo em `draft`/`editing`, alterar manchete, Salvar.
2. Confirmar toast "Rascunho salvo." e que o corpo/headline persistem após
   recarregar a página (não só em memória).

## 6. Retomar (resume)
1. Copiar o `article_id` salvo, recarregar a página, colar o id, Abrir.
2. Confirmar que manchete/corpo/formato/selo aparecem exatamente como salvos.
3. Repetir logado como um staff diferente (sem vínculo) — confirmar erro
   "Matéria não encontrada" (RPC responde `FORBIDDEN`/`ARTICLE_NOT_FOUND`).

## 7. Conflito de revisão
1. Abrir o mesmo `article_id` em duas abas.
2. Salvar uma alteração na aba A.
3. Sem recarregar a aba B, alterar um campo e Salvar na aba B.
4. Confirmar o banner de conflito ("Esta matéria foi atualizada em outra
   sessão") e que o texto digitado na aba B **não** foi perdido nem
   sobrescrito silenciosamente.
5. Clicar "Recarregar" na aba B, confirmar que a versão mais recente (da aba
   A) é carregada.

## 8. Enviar para revisão
1. Com formato/selo/manchete/corpo válidos, clicar "Enviar para revisão".
2. Confirmar toast "Enviado para revisão." e que o editor passa a modo
   somente leitura para o autor (status `content_final`).

## 9. changes_requested
1. Logado como admin, no mesmo artigo em `content_final`, clicar "Devolver
   para correção", preencher um motivo, confirmar.
2. Reabrir como o autor original: confirmar o banner "Correção solicitada"
   com o texto virando editável de novo.
3. Corrigir e reenviar ("Reenviar para revisão"); confirmar volta a
   `content_final`.

## 10. Read-only em ready_for_render
1. Logado como admin no artigo `content_final`, clicar "Aprovar para render".
2. Confirmar que o editor passa a exibir o banner "Matéria congelada —
   Aprovada e aguardando renderização" e nenhum campo editável aparece.
3. Confirmar (via SQL) que nenhuma coluna de conteúdo/produção mudou depois
   disso mesmo tentando reenviar a mesma tela (o trigger de freeze do banco
   já protege; aqui só confirmamos que a UI não oferece a ação).

## 11. Modo admin
1. Com "Simular admin" marcado, abrir um artigo de outro responsável em
   `draft`/`editing`. Confirmar que dá para editar e salvar (o RPC autoriza
   admin mesmo sem ser o responsável).
2. Em `content_final`, confirmar que aparecem os botões "Aprovar para
   render" e "Devolver para correção".

## 12. Modo staff
1. Com "Simular admin" desmarcado, abrir um artigo de outro autor. Confirmar
   erro de acesso (nenhuma ação disponível, sem vazar conteúdo).
2. Abrir o próprio artigo em `content_final`: confirmar que fica somente
   leitura e que os botões de aprovar/devolver **não** aparecem.
