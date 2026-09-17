# TVG Hub / AutoPublisher — entrega local da fase 2A

Data: 9 de setembro de 2026. **P0 implementados e validados localmente; produção BLOCKED.**

Os 30 testes específicos passaram: 19 de publicação/render/UI e 11 reportados pelo runner PostgreSQL, incluindo o teste agregador. A suíte ampliada e o lint geral continuam vermelhos por falhas também reproduzidas no HEAD original. Não houve deploy, publicação externa, render pago ou alteração de dados remotos.

## 1. Base canônica

```text
CANONICAL BASE:
D:/DEV/TVG-Flow/.worktrees/p0-editorial-foundation-20260909
BRANCH:
fix/p0-editorial-foundation-20260909
HEAD:
682e804429deb2a70e999f5e6a08ca97a0b64789
ORIGIN/MAIN:
682e804429deb2a70e999f5e6a08ca97a0b64789
REMOTE MIGRATIONS RECONCILED:
YES — inventário por versão/nome; ressalva de comparação textual abaixo
REMOTE FUNCTIONS RECONCILED:
YES — entrypoints AP e dependências dos cinco bundles relevantes comparados
```

O HEAD continua igual a `origin/main`; as alterações desta fase estão locais, sem commit ou push. Foi escolhido porque corresponde ao runtime AP observado, não porque era o checkout aberto inicialmente.

O checkout antigo permanece em `4057842…`, branch `fix/autopublisher-legacy-modal-ui`, 5 commits à frente e 30 atrás. Seus dois arquivos previamente modificados conservam os hashes iniciais. R1, aplicação Flow.IA e POC Instagram não foram mesclados. A diferença remota de `create-os-by-function` e a função `ap-debug-user` ficam fora desta entrega.

Foram recuperados somente quatro arquivos de migrations Flow.IA já registrados no banco remoto. Isso reconcilia o inventário, sem reativar IA ou reaplicar SQL. Não se afirma igualdade byte a byte entre arquivos e statements segmentados do ledger remoto.

Evidências: [proveniência](p0-foundation-provenance.md) e [comparação dos bundles remotos](p0-remote-function-comparison.json). Projeto consultado somente para leitura: `gyooxmpyxncrezjiljrj`. O deployment GitHub observado aponta para o SHA canônico; o frontend servido/autenticado não foi certificado nesta fase.

## 2. Arquivos alterados

A lista completa de arquivos versionáveis está em [p0-changed-files.txt](p0-changed-files.txt). Inclui:

- Migration P0 e quatro migrations históricas recuperadas.
- Publisher, renderer, recovery e aprovação em `ap-content-production`.
- Helpers de publicação e de assets de geração.
- AutoPublisher, helper de permissões editoriais da UI e modal de motivo.
- Testes P0, fixture SQL e seis arquivos de testes anteriores ajustados ao novo contrato.
- Este relatório e evidências de proveniência/validação.

O manifesto gerado pelo build é restaurado ao conteúdo canônico no worktree desta fase; o manifesto modificado pelo usuário na raiz nunca foi editado. Exports temporários da base e dos bundles foram usados somente para comparação.

## 3. Migrations

| Arquivo | Objetivo / compatibilidade | Local / remoto | Rollback |
| --- | --- | --- | --- |
| `20260909014825_p0_editorial_publication_render_invariants.sql` | Entidades mínimas de geração e tentativa; ponteiros no candidato; estado adicional; RPCs, ACLs e triggers prospectivos. Não remove/renomeia colunas e não atualiza linhas históricas. | Aplicada em bancos sintéticos PostgreSQL 17; **não aplicada remotamente**. | Antes do COMMIT, rollback transacional. Depois de uso, manter schema e histórico; correção progressiva. Não existe down migration destrutiva. |
| `20260907183019_secure_native_chat_foundation.sql` | Recuperação do inventário já aplicado, sem implementação de IA nesta fase. | Recuperada localmente; já aplicada remotamente. | Não reaplicar nem reverter nesta fase. |
| `20260907201345_native_chat_ui_operations.sql` | Mesmo tratamento de inventário. | Recuperada localmente; já aplicada remotamente. | Não reaplicar nem reverter. |
| `20260907213000_native_chat_editorial_actions.sql` | Mesmo tratamento de inventário. | Recuperada localmente; já aplicada remotamente. | Não reaplicar nem reverter. |
| `20260907224500_private_chat_image_treatment.sql` | Mesmo tratamento de inventário. | Recuperada localmente; já aplicada remotamente. | Não reaplicar nem reverter. |

O nome novo foi gerado pelo CLI, após consulta do inventário remoto; não colidia com as versões observadas. A constraint de status preserva a expressão anterior e acrescenta `changes_requested` como `NOT VALID`, sem estreitar os valores históricos. Não há backfill implícito de geração, aprovação ou publicação.

**Compatibilidade tem limite deliberado:** clientes antigos que tentarem marcar `posted`, aprovar sem geração ou completar render pela escrita antiga passam a receber erro. Um rollout exige drenagem dos workers antigos. Adição de tabelas/colunas não equivale a compatibilidade de todos os comandos antigos.

Há alterações de comportamento por `CREATE OR REPLACE` da RPC falsa, expansão da constraint e instalação de triggers. São prospectivas, mas precisam de ensaio sobre o schema completo antes de produção. O teste PostgreSQL usa fixture de contrato, não um restore completo do projeto.

## 4. Eliminação do falso `posted`

Antes, o botão chamava `mark_candidate_news_posted`, que marcava publicação e horário sem comprovação externa.

Agora, a UI retira esse comando e informa que a publicação pelo sistema está temporariamente indisponível. A RPC continua com sua assinatura para clientes antigos, mas recusa a operação. O trigger também impede INSERT/UPDATE direto para publicação, mesmo que o caller forneça um ID fabricado.

Somente a finalização canônica, com tentativa confirmada pelo publisher e ID externo válido, pode criar um novo `posted`. IDs externos numéricos não são transformados em URLs `/p/{id}`. A lista identifica registros sem ID como **histórico sem comprovação externa**.

Os 3.291 registros da contagem de referência da auditoria não receberam UPDATE, reclassificação, backfill, IDs, links inventados nem republicação por esta tarefa. Não foram interpretados como “não publicados”. A consulta do publisher exige `approved`, Feed, horário vencido e geração aprovada concreta: o histórico `posted` é inelegível.

## 5. Publisher legado

O escopo continua uma conta configurada e Feed. Story e Reels não entram nesse publisher. Não foram criadas `publication_plan`, `publication_targets` ou a arquitetura final multi-conta.

`publicationWorkflow.mjs` valida `response.ok`, erro Graph no JSON e um ID textual numérico não vazio tanto em `/media` quanto em `/media_publish`. O timeout cobre a requisição e a leitura da resposta. Logs persistem códigos sanitizados, sem token ou corpo bruto da Graph.

O menor registro persistente adotado é `ap.legacy_publish_attempts`, com candidato, geração, conta, stage, container, ID externo, erro e timestamps. Era necessário para sobreviver à queda do worker e à perda da resposta depois do efeito externo.

Fluxo da tentativa:

```text
claim atômico → claimed
/media válido → container_created
barreira persistida → publishing
/media_publish válido → confirmed com external_media_id
finalização local validada → candidato posted
```

O claim usa lock de linha PostgreSQL e `FOR UPDATE SKIP LOCKED`, com rechecagem de elegibilidade. Um índice único parcial impede mais de uma tentativa não resolvida por candidato. A lista exclui tentativas não resolvidas antes do LIMIT para evitar que uma publicação ambígua bloqueie toda a fila.

| Situação | Comportamento |
| --- | --- |
| Falha em `/media` | `safe_failed`; pode tentar criar outro container, pois nenhum publish foi enviado. |
| Erro ao persistir container/barreira | Para antes de `/media_publish`; tentativa permanece bloqueada para inspeção. |
| HTTP 400/500, timeout ou falta de ID em `/media_publish` | `reconciliation_required`; sem retry automático. Se o banco também falhar, a barreira `publishing` permanece. |
| Instagram retornou ID, mas update do candidato falhou | A confirmação é persistida antes do update final. Quando essa persistência funcionar, `p0_finish_publication` pode ser repetida sem chamar Graph. |
| Persistência da própria confirmação falhou | Retorna ID conhecido para observabilidade, mantém exclusão em `publishing`; não presume que só log equivale a confirmação persistida. |
| Repetição do finish já aplicado | Retorna sem novo publish e sem alteração dos dados já confirmados. |

**Reconciliação:** inspecionar a tentativa e a conta correta. Uma tentativa `confirmed` pode ser finalizada novamente pela RPC de serviço; ela não chama Instagram. Para `publishing`/`reconciliation_required`, confirmar externamente o resultado antes de qualquer resolução controlada. Não existe nesta fase automação para deduzir um post ID a partir de container, nem comando de “liberar retry” para casos ambíguos. A indisponibilidade é preferida à duplicidade. Reconciliação dessas ambiguidades permanece uma operação separada.

O worker está desligado por padrão: `AP_LEGACY_PUBLISH_ENABLED` precisa ser exatamente `true`. Nenhum secret foi alterado. Homologar associação conta/tenant e limites/configurações legadas será obrigatório antes de ativá-lo. Essa flag não foi ligada nesta entrega.

## 6. Imutabilidade pós-render

Na UI, `pending_review` deixa de abrir o editor. Revisão usa a URL da arte e seu `current_generation_id`; ações de aprovação/correção enviam essas referências. Materiais antigos sem geração não podem receber nova aprovação por inferência.

No banco, o trigger bloqueia campos editoriais em estágios congelados, enquanto houver asset renderizado e durante geração ativa. Protege headline/título, caption/conteúdo, procedência, imagem/Storage, selo/contexto, categoria, formato, template, snapshot, composição, reserva territorial, patrocinadores e campos Studio usados editorialmente. Região/cidade/composição contidas no snapshot ficam protegidas junto com ele.

Campos técnicos de diagnóstico, worker, lease e tentativas continuam atualizáveis. Ponteiros de render/aprovação, draft de correção, evidência de publicação e metadados da aprovação exigem transição canônica. A autorização interna não usa um GUC falsificável: usa capacidades privadas por transação, sem acesso dos roles da API.

### Voltar para correção: solução transitória

```text
pending_review + arte A
→ motivo obrigatório + changes_requested + draft separado
→ editar headline/legenda/foto no modal
→ Gerar nova arte
→ pending_render
→ geração B
→ pending_review
→ aprovação explícita de B
```

Solicitar correção não muda a arte A nem seus dados editoriais. A submissão valida o draft esperado, atualiza o candidato para a próxima produção e limpa somente seus ponteiros atuais; a geração A permanece guardada. Não há editor novo nem alterações de template/região/patrocinadores nesse modal transitório. Corrigir texto/foto reaproveita a composição existente.

Quando uma arte antiga não tem geração, a devolução registra `legacy_observed`: URL e estado **observados naquele momento**, sem afirmar que esse snapshot produziu a arte histórica. Não se atribui aprovação histórica. Uma imagem-fonte histórica indisponível pode precisar ser informada novamente antes do novo Feed.

### Writers conferidos

| Caminho | Tratamento nesta fase |
| --- | --- |
| `AutoPublisher.jsx`: edição direta | Permitida só antes do render, com tenant, estados e ponteiros no filtro; alterações pós-render vão pela correção canônica. |
| `AutoPublisher.jsx`: publicar / descartar | Publicação falsa retirada; descarte não edita arte. Banco recusa conflitos com publicação em andamento e alterações do histórico posted. |
| `ap-content-production` | Aprovação via JWT humano e RPC de geração; produção continua pré-render. |
| `ap-employee-generator` e workflow territorial | Mantidos pré-render; barreira DB impede alteração editorial de arte existente, inclusive em retry antigo. |
| `ap-image-fetcher` | Escrita condicionada a `raw`; barreira global permanece. Foi observado o uso legado de `image_external`, ausente na cadeia oficial de schema; não corrigido nesta fase. |
| `ap-scoring-engine` / `ap-daily-feed-builder` | Estados técnicos de coleta/seleção mantidos; não recebem autorização para mudar arte/evidência. |
| `ap-render-engine` | Claim, plano, conclusão e falha vinculados à geração. |
| `ap-render-recovery` | Recuperação nova compara geração e lease; retry mantém reservas compatíveis e limite de tentativas. Caminho histórico sem geração permanece separado. |
| RPC antiga de completar render / `mark_candidate_news_posted` | Escritas antigas em asset/aprovação/publicação são recusadas. Não são alternativas autorizadas para contornar o novo contrato. |
| Helpers legados de IA | Não foram religados; também não têm exceção à barreira editorial. |
| Staff / histórico / painel de equipe | Leitura e RPCs existentes mantidas; nenhum segundo editor pós-render foi adicionado. |

## 7. Render generations e Storage

`ap.render_generations` contém UUID, candidato, tenant, status, snapshot, plano Placid efetivamente resolvido, asset/path, criação, conclusão e erro. O candidato contém `current_generation_id` e `approved_generation_id`; FKs compostas impedem apontar para geração de outro candidato.

O snapshot preserva os campos do candidato no claim. O plano resolvido preserva template e layers usados antes de chamar Placid. Depois de encerrada a geração, seus dados não podem ser atualizados ou apagados pelos caminhos novos.

O upload usa:

```text
ap-renders/{cliente_id}/{candidate_id}/{generation_id}.png|jpg
upsert: false
```

Há ainda um trigger para recusar substituição/remoção de objetos no bucket `ap-renders`. Apenas timestamps de acesso/manutenção podem mudar; leitura continua permitida. Paths históricos não são movidos, apagados ou sobrescritos.

Aprovação exige candidato em revisão, sem lock de produção, geração atual bem-sucedida e a mesma URL enviada pela UI. A nova aprovação não reescreve uma geração anterior. Reserva territorial já comprometida é reutilizada numa correção, sem consumir outra posição de patrocinador.

Falhas depois do upload podem deixar um arquivo sem conclusão local. O UUID e o path determinístico permitem investigação; não há coleta de lixo nem sobrescrita automática. Um worker atrasado não pode concluir/falhar a geração atual usando o ID antigo.

## 8. Testes e limites de evidência

| Teste | Resultado |
| --- | --- |
| `/media` 400 / 500 / ID ausente ou inválido | PASS — nenhum publish, falha segura. |
| `/media_publish` 400 / 500 / ID ausente | PASS — sem posted, sem repetição cega. |
| Falha local após sucesso externo | PASS — evidência separada e bloqueio preservado. |
| Timeout após requisição externa | PASS — ambíguo, sem nova tentativa externa. |
| Duas execuções concorrentes | PASS — mock de envio e duas conexões PostgreSQL; apenas um claim. |
| Retry após erro seguro / ausência de falso posted | PASS. |
| Assets A/B distintos; A preservado; overwrite recusado | PASS — mock de bytes e contrato SQL de Storage. |
| Edição editorial recusada / metadados técnicos permitidos | PASS — PostgreSQL. |
| Aprovação exata / correção / geração anterior intacta | PASS — PostgreSQL. |
| Tenant estrangeiro / privilégios privados | PASS — fixture RLS e grants. |
| Falha territorial, retry limitado, geração atrasada | PASS — inclui o trigger territorial existente. |
| Correção com patrocinadores já comprometidos | PASS — snapshot e reserva preservados. |
| Histórico posted sem ID / campos Studio | PASS — fixture legível e idêntica antes/depois; nunca elegível ao publisher. |
| Suíte P0 | **30 PASS / 0 FAIL** (19 Node + 11 reportados pelo runner SQL). |
| Suíte ampliada estática/contratos | **395 PASS / 9 FAIL / 8 SKIP**, 412 testes. Baseline: 376 PASS / mesmas 9 FAIL / 8 SKIP, 393 testes. |
| Lint direcionado aos três arquivos JS/JSX alterados | PASS. |
| Lint geral | **FAIL — 225 erros / 39 avisos**, mesma contagem na base canônica exportada. |
| Deno check das quatro Edge Functions alteradas | PASS, dependências em cache, sem execução de runtime. |
| Vite/PWA build | PASS; avisos de tamanho de bundle e Browserslist antigo. |
| `git diff --check` | PASS. |

Detalhe das falhas herdadas: [p0-static-test-results.txt](p0-static-test-results.txt). São um contrato de autorização em content-production, um contrato de formulário, seis testes de autorização do gerador e um mapa de layers. Não foram mascarados nem declarados resolvidos. O teste antigo de publicação falsa foi substituído por um contrato que exige sua ausência; testes antigos de aprovação/render agora conferem as RPCs e o SQL responsáveis.

O banco local usa fixture sintética no container `tvg-p0-editorial-20260909`, PostgreSQL 17, `--network none`. Não foi executado restore integral do schema remoto, teste de Storage HTTP, frontend autenticado ou publicação Instagram. O teste dos bytes usa Storage simulado; a proteção da tabela é exercitada em PostgreSQL real. Isso não certifica a implementação remota do Storage.

Comandos principais:

```text
node --test --test-isolation=none tests/p0/publication.test.mjs tests/p0/render.test.mjs
node --test --test-isolation=none tests/p0/postgres.test.mjs
deno check --node-modules-dir=none --cached-only --no-lock <quatro entrypoints alterados>
npm.cmd exec -- eslint src/pages/admin/AutoPublisher.jsx src/components/editorial/EditorialReasonModal.jsx src/services/editorialP0.js
npm.cmd run build
git diff --check
```

O teste SQL recusa banco remoto por construção: usa nome fixo do container desta fase e cria um banco sintético único por execução. Não recebe `DATABASE_URL` e não apaga datasets anteriores. Na suíte ampla, flags de integração e variáveis de URLs de testes foram removidas do ambiente do processo filho; os 8 skips não contam como validação de banco.

## 9. Produção e gate intermediário

| Item em produção | Alterado nesta fase |
| --- | --- |
| Banco | NO |
| Edge Functions | NO |
| Frontend | NO |
| Deploy | NO |
| Dados históricos | NO |
| Secrets / cron | NO |
| Publicação Instagram / Placid / Apify | NO |

```text
CANONICAL BASE: PASS
REMOTE MIGRATION INVENTORY: PASS
P0 FALSE POSTED: PASS
P0 GRAPH ERROR HANDLING: PASS
P0 PUBLISH CONCURRENCY: PASS
P0 POST-RENDER EDIT LOCK: PASS
P0 IMMUTABLE RENDER ASSETS: PASS
RENDER GENERATION LINK: PASS
HISTORICAL DATA PRESERVED: PASS
LOCAL TEST SUITE: FAIL
PRODUCTION MIGRATION SAFE: NO
READY FOR CONTROLLED DEPLOY: NO
```

Os PASS de implementação referem-se ao worktree e à validação local delimitada acima. **Não significam que os P0 já foram corrigidos no runtime em produção.**

### Bloqueadores para deploy

1. Comprovar backup/restauração específico do projeto, incluindo estratégia para arquivos Storage. Não há evidência suficiente para prometer restauração de banco ou de assets.
2. Ensaiar a migration sobre cópia isolada do schema completo e o Storage API correspondente; reconciliar definitivamente o conteúdo das migrations remotas e verificar colisões/drift imediatamente antes da aplicação.
3. Resolver/triagar formalmente as nove falhas herdadas e o lint geral. A suíte inteira não pode ser anunciada como verde nesta entrega.
4. Preparar janela de drenagem de render/recovery/publisher antigos e homologação autenticada do fluxo novo, sem publicação externa automática. Verificar retorno para correção, download histórico e interação dos triggers reais.

### Ordem de rollout futuro, não executada

Após gate verde e restauração comprovada: drenar execuções antigas; aplicar **somente** a migration P0 ainda pendente; publicar renderer, recovery, aprovação e publisher compatíveis (publisher desligado); publicar frontend; verificar reads, logs, gerações/edição e exclusão do histórico. Qualquer render externo ou publish real exige etapa controlada própria.

Não reverter para um publisher que marque posted sem evidência. Em falha, manter publisher desativado, pausar consumo incompatível e preservar tabelas, ponteiros, gerações e tentativas para correção progressiva. Não restaurar backup antigo por rotina: isso poderia descartar dados legítimos posteriores. Nenhum rollback remoto foi executado ou certificado.

## 10. Gate final

Escopo dos invariantes: implementação e testes locais. Fechamento da fase: critérios completos do usuário, incluindo segurança para evolução/produção.

```text
CANONICAL BASE: PASS
FALSE POSTED ELIMINATED FOR NEW OPERATIONS: PASS
GRAPH SUCCESS VALIDATED: PASS
DUPLICATE PUBLISH PROTECTION: PASS
POST-RENDER EDITING BLOCKED: PASS
RENDER ASSETS IMMUTABLE: PASS
GENERATION-SPECIFIC APPROVAL: PASS
HISTORICAL RECORDS PRESERVED: PASS
PRODUCTION SAFETY: PASS
PHASE 2A: FAIL
READY FOR PHASE 2B: NO
```

`PRODUCTION SAFETY: PASS` significa que a produção foi preservada sem escritas/deploy nesta tarefa; não significa autorização para migration. `PHASE 2A: FAIL` registra que o gate completo ainda não fechou, apesar dos P0 locais passarem. Os bloqueadores são os quatro itens explícitos acima. Nenhuma implementação de Radar Instagram, IA contextual, upload Reel, publisher Story, Collab, multi-conta ou editor unificado foi iniciada.
