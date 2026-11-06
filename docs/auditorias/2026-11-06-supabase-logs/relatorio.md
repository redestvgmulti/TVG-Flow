# Auditoria dos logs de produção — 06/11/2026

## Resultado

O erro da captura foi confirmado em produção: **3.596 ocorrências de `EDITORIAL_REVISION_CONFLICT` na função `ap.save_editorial_article_draft_v2`**, entre 08h e 09h de Brasília. Todas vieram da mesma conexão PostgREST e de transações distintas. Uma consulta posterior encontrou essa conexão executando a mesma RPC.

A causa imediata está confirmada: a RPC compara a revisão esperada com a atual e lança SQLSTATE `40001` quando elas diferem. A explicação mais forte para a repetição é o mecanismo interno de retry de transações do PostgREST/hasql para `40001`, documentado pelo próprio projeto. **A versão instalada do PostgREST, a requisição HTTP original e o artigo afetado não foram identificados; portanto, o mecanismo de repetição permanece uma inferência de alta confiança.**

Também foram encontrados 71 eventos de timeout do PostgREST, uma chamada `404` a uma função de notificações inexistente e duas desconexões do fluxo de replicação do Realtime, seguidas de inicialização/decodificação posteriores. A relação causal desses eventos com o conflito editorial não foi comprovada.

Nenhuma correção foi aplicada. Não foram encerradas conexões, executadas RPCs de negócio, disparadas notificações nem geradas matérias de teste.

## Escopo e método

- Projeto confirmado pela Management API: `TVG - Flow`, `gyooxmpyxncrezjiljrj`, estado informado `ACTIVE_HEALTHY`.
- Janela da captura: `2026-11-06T11:00:00Z` a `2026-11-06T12:00:00Z`, equivalente a 08h–09h em `America/Sao_Paulo`.
- Ampliação: `2026-11-05T14:25:00Z` a `2026-11-06T14:25:00Z`, limitada a 24 horas.
- Leitura pela API oficial de logs e pelo endpoint SQL `/database/query/read-only`.
- Credencial existente do CLI usada apenas no cabeçalho de autenticação da API oficial, sem impressão ou gravação em arquivos.
- Código local inspecionado no commit `14c118356db5d0723d3d8be9918a8a137367d7c1`; alterações preexistentes preservadas.
- Funções SQL de produção lidas diretamente no catálogo. A confirmação do `40001` não depende apenas de migrations locais.

A sessão do CLI estava salva e funcionou na API oficial pelo cliente HTTP do Windows. O CLI 2.122.0 continuou apresentando `TransportError`, inclusive na listagem de projetos. A origem desse erro local de transporte não foi determinada. Não houve resposta administrativa `401`/`403` nesse caminho autenticado. O acesso visual não foi utilizado nesta retomada.

## Inventário da janela

| Fonte | Eventos | Classificação observada |
|---|---:|---|
| Postgres | 3.606 | 3.596 `ERROR` editoriais e 10 eventos `LOG` |
| API Gateway (`edge_logs`) | 1.101 | 678 HTTP 200; 206 HTTP 201; 206 HTTP 204; 11 HTTP 101 |
| Logs internos de funções | 226 | 129 `log` e 97 `info`; nenhum `warn`/`error` nessa janela |
| Storage | 223 | Todos com nível `info` |
| Pool de conexões | 155 | 75 logins, 68 encerramentos solicitados pelo cliente, 6 expirações por ociosidade, 6 novas conexões ao servidor |
| Invocações de funções | 99 | 98 HTTP 200 e 1 HTTP 404 |
| PostgREST | 71 | Eventos de timeout do servidor Warp |
| Realtime | 32 | Nível `info`, incluindo duas desconexões e inicializações posteriores |
| Auth | 8 | Nível `info` |
| Auth audit | 8 | Nível `info` |

Essas fontes representam camadas diferentes: não devem ser somadas como quantidade de ações de usuários. SQLSTATE `40001` também não é um código HTTP. A ausência de HTTP 5xx no gateway consultado não invalida os erros internos do banco; não foi localizada uma resposta de gateway para cada uma dessas transações.

## Achados

### A-01 — Prioridade alta: conflito editorial usa código de serialização que pode provocar retry interno

**Evidência confirmada:**

- 3.596 erros na janela, de `11:00:00.286Z` a `11:59:59.325Z`, aproximadamente um por segundo.
- Contexto de todas as ocorrências: `ap.save_editorial_article_draft_v2(uuid,text,text,text,text,text,jsonb,uuid,integer) line 29 at RAISE`.
- Sessão `6ac3ed91.f10de`, PID `987358`, aplicação `postgrest`, usuário técnico `authenticator`.
- 3.596 identificadores de transação distintos nessa sessão.
- Na ampliação de 24 horas, 86.087 conflitos na mesma sessão/PID; primeiro evento já no início da janela e último evento retornado às `14:22:45.321Z`. A consulta não estabelece o início real do incidente nem sua cessação; o limite final pode incluir atraso de ingestão.
- Às `14:22:09Z` (11h22 de Brasília), `pg_stat_activity` encontrou o PID `987358` ativo na RPC de salvamento. O campo `query_start` é da tentativa observada, não prova a idade da requisição HTTP original. O início do backend, em 05/10, também não prova que o incidente começou nessa data.

**Condição na função de produção:**

```sql
IF p_expected_revision_number IS NOT NULL
   AND p_expected_revision_number <> v_current_revision THEN
    RAISE EXCEPTION 'EDITORIAL_REVISION_CONFLICT' USING ERRCODE = '40001';
END IF;
```

O número esperado vem do cliente. Reexecutar exatamente a mesma requisição não atualiza esse número. A validação ocorre antes da inserção de uma nova revisão, portanto o ramo conflitante rejeita a gravação; esses erros não demonstram corrupção ou perda de conteúdo. O impacto confirmado é a repetição de transações e logs; CPU, WAL, custos, perda de texto não salvo e abrangência de usuários afetados não foram medidos.

**Mecanismo provável:** PostgREST/hasql pode repetir transações que terminam com `40001`, código de falha de serialização. Esse comportamento está documentado na [issue oficial #3673](https://github.com/PostgREST/postgrest/issues/3673) e na [correção #4222](https://github.com/PostgREST/postgrest/pull/4222). A combinação de revisão obsoleta invariável, mesma conexão, novas transações a cada segundo e persistência por mais de uma janela é fortemente compatível com esse mecanismo. Não foi comprovado que o navegador envia milhares de requisições distintas.

**Superfície compartilhada:** cinco funções de produção usam o mesmo erro editorial com `40001`:

1. `ap.save_editorial_article_draft`;
2. `ap.finalize_editorial_article`;
3. `ap.save_editorial_article_draft_v2`;
4. `ap.finalize_editorial_article_v2`;
5. `ap.approve_editorial_article_for_render`.

Somente `save_editorial_article_draft_v2` apareceu como origem dos 3.596 erros da captura. A existência das outras funções não significa que todas falharam no período.

**Referências locais:**

- `supabase/migrations/20260920002600_editorial_ai_draft_vertical_slice.sql:694` e `:751` — salvamento/finalização v2.
- `supabase/migrations/20260920153000_editorial_self_review.sql:105` — aprovação.
- `src/services/editorialArticlesService.js:16` — erro de domínio derivado de `error.message`.

**Correção recomendada, não implementada:** emitir um erro de domínio não sujeito a retry de serialização, por exemplo `PT409`, mantendo a mensagem `EDITORIAL_REVISION_CONFLICT`, a comparação de revisão, os bloqueios e as verificações de acesso. PostgREST documenta [códigos personalizados `PTxyz`](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes). A implementação deve tratar todas as assinaturas ativas, por migration nova, sem editar migrations antigas. O uso atual de `error.message` permite preservar o identificador de domínio, mas a compatibilidade deve ser testada.

Para contenção de um loop já em andamento, avaliar uma ação operacional dirigida à conexão comprovadamente afetada após a correção e com autorização de operação. Não foi executado cancelamento, encerramento de backend ou reinício de serviços. Evitar desabilitar globalmente proteções de concorrência ou a recuperação do pool.

### A-02 — Prioridade média: recuperação de conflito incompleta no assistente

Em `src/components/editorial/CanonicalArticleWizard.jsx:479`, `saveHumanDraft()` envia `revisionNumberRef.current`. A referência é atualizada após leitura bem-sucedida do artigo, mas o `catch` do salvamento apenas limpa o identificador da tentativa e mostra o erro. Não há nesse fluxo uma ação explícita para comparar as alterações locais com a versão remota e recuperar a edição em conflito.

Assim, uma nova tentativa sem nova leitura pode enviar a mesma revisão obsoleta. **Essa fragilidade está confirmada por inspeção estática, mas não foi demonstrada como gatilho da requisição original deste incidente.** O salvamento nesse assistente é acionado por botão; não foi encontrada uma rotina de autosave a cada segundo nos caminhos examinados.

O editor alternativo `CanonicalEditorialEditor.jsx` já possui estados de conflito e recuperação por recarga; isso não cobre automaticamente o assistente `CanonicalArticleWizard`.

**Recomendação:** preservar o texto digitado, bloquear repetição automática desse conflito e oferecer recuperação explícita com comparação/recarga. Não basta atualizar silenciosamente o número da revisão e reenviar o texto antigo: isso pode sobrescrever alterações de outra sessão. Verificar também exclusão mútua entre salvar e finalizar no assistente; os estados de processamento atuais são separados.

### A-03 — Prioridade média: 71 eventos de timeout do PostgREST

- 70 eventos: `Warp server error: Thread killed by timeout manager`.
- 1 evento com duas mensagens concatenadas do mesmo tipo. A contagem é de eventos ingeridos, não de requisições distintas.
- Primeiro às `11:01:07.307226Z`; último às `11:59:37.472176Z`.

São erros reais da camada de atendimento HTTP. Os eventos coletados não contêm identificação suficiente para associar cada timeout à RPC editorial. Não é possível afirmar que os 71 eventos foram causados pelo loop, por saturação do pool ou pelo mesmo usuário.

**Recomendação:** após corrigir o tratamento de conflito, comparar nova janela de duração equivalente e correlacionar requisições lentas com métricas do pool e identificadores de rastreamento. Não aumentar limites de timeout como correção presumida.

### A-04 — Prioridade baixa: chamada a função de notificações inexistente

- Às `11:23:02.148Z` (08h23 de Brasília), uma chamada a `/functions/v1/process-notifications` retornou HTTP `404`.
- Cliente informado: `curl/8.5.0`, sem referer. Não foi identificado o operador ou processo que fez a chamada.
- `process-notifications` não aparece na lista atual de funções publicadas.
- A busca nos diretórios ativos `src`/`supabase/functions` e nas definições SQL de `public`/`ap` não encontrou referência literal ao endpoint.
- Existe um processamento SQL de fila chamado `public.process_notification_queue`, distinto dessa Edge Function. A lista de cron contém um job com nome relacionado à fila; isso não comprova que ele tenha chamado a URL ausente. Nenhum job cujo comando continha a palavra `editorial` foi encontrado entre os 13 jobs listados; isso também não exclui chamadas indiretas.

**Recomendação:** localizar o script/check externo que chamou esse endpoint e alinhar sua verificação ao fluxo existente. Um `404` isolado não justifica publicar uma função substituta nem comprova falha geral de notificações. Não houve envio de notificação de teste.

### A-05 — Monitorar: desconexões do Realtime e mensagens de replicação

Foram observadas desconexões do broadcast às `11:08:27.996Z` e `11:33:16.734Z`. No banco, houve dois eventos `unexpected EOF on standby connection` próximos desses horários, registrados como `LOG`, código `08P01`. Inicializações posteriores do Realtime e mensagens de ponto consistente/decodificação apareceram por volta de `11:13:16Z` e `11:39:46Z`.

A evidência é compatível com desconexão e reconexão do fluxo. Não demonstra perda definitiva de dados, atraso de replicação sustentado ou relação causal com o conflito editorial. Não houve teste visual/autenticado de entrega de eventos durante esses intervalos.

## Validação executada

```text
node --test tests/master-v1/editorial-editor-contract.test.mjs tests/master-v1/editorial-editor-reducer.test.mjs tests/master-v1/editorial-editor-form.test.mjs
40 testes aprovados; 0 falhas.
```

A primeira execução no sandbox não iniciou os subprocessos (`spawn EPERM`); a repetição fora dessa restrição executou os 40 testes com sucesso. Esses testes validam regras de interface, formulários e reducer. Não validam o retry interno da versão instalada do PostgREST e não certificam o fluxo de produção.

## Próxima correção e critérios de aceite

1. Trocar a classificação do conflito de domínio nas cinco funções, mantendo concorrência, autorização e idempotência.
2. Validar em ambiente isolado com banco e PostgREST reais: duas sessões leem revisão N; a primeira grava N+1; a segunda recebe conflito prontamente, sem nova revisão e sem loop interno. Não usar registros reais como fixtures.
3. Recuperar o conflito no assistente preservando alterações locais e evitando sobrescrita silenciosa.
4. Em produção, após liberação separada, confirmar desaparecimento da repetição e comparar timeouts em nova janela. Não afirmar resolução apenas porque testes de frontend passam.
5. Investigar o `curl` que chama a função ausente e acompanhar as reconexões do Realtime como achados separados.

## Evidências e limites

O arquivo `evidencias.json` contém agregações e identificadores técnicos mínimos. Não inclui tokens, cabeçalhos de autorização, IPs de usuários, nomes de autores, e-mails ou conteúdo editorial. As consultas reproduzíveis estão em `consultas.sql`.

Limites: não foi obtido o corpo da requisição original, logo não há artigo/usuário/revisão esperada identificados; a versão do PostgREST não foi informada pelo endpoint de saúde consultado; não houve reprodução de escrita em produção nem validação visual. O incidente continuava observável no momento da coleta, mas este relatório é um retrato temporal.
