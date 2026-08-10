# 🔬 LAUDO DE AUDITORIA — MOTOR EDITORIAL IA
**FlowOS AutoPublisher Enterprise | Auditoria End-to-End**
*Data: 22 de Fevereiro de 2026 | Versão auditada: commit `2a637b6`*

---

## 🔴 SUMÁRIO EXECUTIVO

A arquitetura do **Motor Editorial IA** apresenta uma intenção técnica sólida, estabelecendo a base para um pipeline complexo gerenciado por IA. No entanto, a auditoria rigorosa de código identificou **9 vulnerabilidades reais** que exigem intervenção. Destas, **4 são classificadas como críticas e bloqueantes** para o lançamento faturável em produção comercial.

**No estado atual, o módulo NÃO ESTÁ APTO para produção.**

Abaixo segue o descritivo de cada vetor de risco encontrado durante a inspeção.

---

## 1️⃣ AUDITORIA DE SEGURANÇA

### [SEC-1] 🔴 CRÍTICO — Função Vault RPG Sem Restrição de Segurança
- **Local:** `supabase/migrations/20260222180500_create_vault_rpc.sql`
- **Problema:** A função `get_decrypted_secret` foi criada como `SECURITY DEFINER` e sem o bloqueio de permissão de `execute` para a role `public` ou `authenticated`.
- **Exploração:** Qualquer usuário final autenticado pode chamar essa função via API PostgREST (`/rpc/get_decrypted_secret`) e extrair qualquer chave de API de qualquer tenant se souber ou bruteforcear o UUID do segredo.
- **Correção Mínima:** Revogar permissões e garantir que apenas a `service_role` possa executá-la.

### [SEC-2] 🔴 CRÍTICO — Fallback Silencioso para a Chave Mestre
- **Local:** Edge Function `ap-editorial-test/index.ts`
- **Problema:** Caso a resolução da chave do tenant no Vault falhe, o sistema engole o erro e faz fallback automático usando a variável de ambiente base do servidor (`OPENAI_API_KEY`).
- **Exploração:** Um cliente sem chave configurada (ou com erro no DB) processará todas as suas chamadas à custa da Plataforma CityOS, minando o conceito de custo isolado (Bring Your Own Key).
- **Correção Mínima:** Remover o fallback global em execuções transacionais em nome do cliente.

### [SEC-3] 🔴 CRÍTICO — Vazamento do Prompt Snapshot para o Frontend
- **Local:** Edge Function `ap-editorial-test/index.ts`
- **Problema:** Após processamento, o backend envia a string inteira do `prompt_snapshot` construído de volta para o browser no JSON de resposta.
- **Exploração:** Ferramentas de DevTools (Network tab) ou proxies conseguem capturar o prompt completo do veículo (que pode conter regras proprietárias e até mesmo contexto RAG privado). É um vazamento massivo de Propriedade Intelectual.
- **Correção Mínima:** O snapshot deve ficar APENAS no BD (`editorial_logs`). O endpoint deve devolver ao frontend apenas um `log_id` ou sinal de sucesso.

### [SEC-4] 🟡 RISCO MODERADO — Cross-Origin Universal (CORS Básico)
- **Local:** Cabeçalhos das 4 Edge Functions.
- **Problema:** O uso de `"Access-Control-Allow-Origin": "*"` permite que páginas em qualquer domínio façam requisições aos endpoints.
- **Correção Mínima:** Restringir aos domínios do FlowOS e ambientes de preview.

### [SEC-5] 🟡 RISCO MODERADO — Risco de Injeção de Prompt via RAG
- **Local:** `_shared/editorialPromptBuilder.ts`
- **Problema:** O contexto carregado do RAG (arquivos subidos pelo usuário) é concatenado diretamente no prompt de sistema sem delimitações estritas de sandboxing. Se um invasor submeter um PDF com comandos de instrução reversa, o modelo acatará.

---

## 2️⃣ AUDITORIA DE CONTROLE FINANCEIRO

### [FIN-1] 🔴 CRÍTICO — Race Condition no Incremento de Tokens
- **Local:** `ap-editorial-test/index.ts` e `ap-content-production`
- **Problema:** O código utiliza o padrão "Ler, Somar e Atualizar" de forma não-atômica:
  1. Lê os tokens atuais (ex: 1000)
  2. Chamada remota na OpenAI (demora 3 a 5 segs)
  3. Salva: 1000 + novos tokens
- **Exploração:** Em requisições massivas em paralelo (100 itens simultâneos para geração por cron), todas lerão o valor de 1000 e atualizarão quase juntas, subscrevendo o valor. Milhares de tokens gastos não serão processados no billing. O limite financeiro falhará.
- **Correção Mínima:** A atualização deve ser feita com incremento de banco de dados (`monthly_token_used = monthly_token_used + :new_tokens`) via RPC ou chamada SQL segura.

### [FIN-2] 🟡 RISCO MODERADO — Reset Mensal Não Automatizado
- **Problema:** A zeragem dos tokens depende de que o cliente DISPARE um request no mês vigente. Clientes parados ou requisições na virada de lote acarretam estagnação contável.

---

## 3️⃣ AUDITORIA DE CONHECIMENTO RETIDO (RAG)

### [RAG-1] 🔴 CRÍTICO — RAG Morto (Inativo no Pipeline)
- **Local:** `_shared/editorialPromptBuilder.ts`
- **Problema:** Apesar do upload e do chunking + embedding em pgvector estarem funcionais, a base vetorial NUNCA é lida no fluxo principal. A função `getEditorialContext` faz mock retornado um array vazio: `let ragContext = [];`.
- **Exploração:** A busca semântica (`match_editorial_documents`) nunca acontece para as notícias antes do prompt ser construído. O RAG foi implementado estruturalmente, mas não ativado em produção.
- **Correção Mínima:** É preciso invocar a RPC gerando o vetor da notícia atual e buscando contexto antes da resolução.

### [RAG-2] 🟡 RISCO MODERADO — Ausência de Truncagem nos RSS / Uploads
- **Problema:** O Input do feed RSS não tem garantias de limite. Notícias imensas explodem o custo (`prompt_tokens`) instantaneamente.
- **Correção Mínima:** Restringir o chunk enviado para análise (`conteudo.slice(0, 3000)`).

---

## 4️⃣ OUTRAS CONSTATAÇÕES DE ENGENHARIA E UX TÉCNICA

* **Resiliência Positiva:** O fallback caso o Editorial falhe, retrocedendo para o gerador raiz é excelente (Linha de salvamento).
* **Ausência no Multi-Tenant Mestre:** Algumas views não checam a flag `admin` ou `platform-admin`, permitindo a usuários do nível standard gravarem alterações pesadas em `editorial_rules` e `settings` desde que logados e amarrados no tenant.
* **Componentes V2 não Seguidos:** Alguns botões de adicionar regras na tela de admin chamam nativos `window.prompt()` ou `window.alert()` em vez dos componentes `Toast` e Modal do FlowOS V2.

---

## 📊 Veredito da Classificação

| Dimensão Auditada | Nota Avaliativa | Comentário |
| :--- | :---: | :--- |
| **Arquitetura & Intenção** | **7 / 10** | Bem pensado, modelagem de tabelas muito correta. |
| **Segurança do Veículo (RLS)**| **4 / 10** | Abertura do Vault e Leak de prompt derrubaram a nota. |
| **Controle Financeiro** | **3 / 10** | Race condition torna o billing inútil em grande escala. |
| **RAG (Eficiência Prática)** | **1 / 10** | Funcionalidade esquecida de ser injetada de volta ao ciclo. |
| **Estabilidade de Pipeline** | **6 / 10** | Tem fallbacks muito bem construídos, falha no memory cron log. |

### ⛔ STATUS: REPROVADO PARA PRODUÇÃO C/ BLOQUEIOS

**Ações Imediatas Demandadas (P0):**
1. Atualizar a DDL do Vault para restringir o `get_decrypted_secret` aos `service_roles`.
2. Remover o envio do JSON transposto de volta ao client em requests HTTP.
3. Consertar a operação matemática (race condition) do faturamento/billing de tokens.
4. Conectar o RAG gerando a simulação vetorial no Worker.
5. Inativar fallback silencioso para evitar parasitagem da infra base.

Relatório estruturado com base estrita no código entregue no build atual. Nenhuma inferência externa ou heurística foi validada sem conferência nativa.
