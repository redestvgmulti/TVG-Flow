# Rollout: `misto` → `tvg_img`

O risco desta mudança não está nos testes. Está nos minutos em que banco, Edge
Function e dois builds de frontend podem estar executando contratos diferentes.
Este documento existe para que essa janela seja **compatível por construção**, e
não por sorte de sincronia.

## O invariante que nunca pode quebrar

> Nenhuma matéria nova nasce com `visual_model = 'misto'`.

Todo o resto — tolerância de leitura, lookup duplo, política de entrada — é
subordinado a isso. A garantia é estrutural, não procedural: o generator congela
no snapshot o **modelo canônico** (`visualModel`), nunca `config.visual_model`.
Logo, mesmo lendo uma linha ainda gravada como `misto`, o snapshot sai `tvg_img`.

## As quatro fases

| Fase | O que sobe | Banco | Frontend antigo | Frontend novo |
|---|---|---|---|---|
| 1 | Generator transicional | `misto` | ✅ | ✅ |
| 2 | Migration `20260727120000` | `tvg_img` | ✅ | ✅ |
| 3 | Frontend novo | `tvg_img` | ✅ | ✅ |
| 4 | `AP_LEGACY_VISUAL_MODEL_INPUT=reject` | `tvg_img` | ❌ (proposital) | ✅ |

### Fase 1 — generator transicional

Sobe **antes** da migration. Este build:

- aceita `misto` e `tvg_img` na entrada e normaliza ambos para `tvg_img`;
- procura o master por `visual_model IN ('tvg_img', 'misto')`, então encontra a
  linha esteja ela renomeada ou não;
- congela sempre o slug canônico no snapshot;
- preserva snapshots históricos literalmente.

Sem esta fase, a migration criaria uma janela em que a função antiga procura
`misto` numa tabela que já só tem `tvg_img`.

### Fase 2 — migration

Renomeia as linhas e endurece o `CHECK`. Só o slug muda: `enabled`,
`master_template_uuid` e `layer_map` ficam intactos, e `ap.candidate_news` não é
tocada.

Provada pelos gates (`bash tests/master-v1/run-migration-gates.sh`), que
executam o **arquivo real** dentro de uma transação:

| Gate | Prova |
|---|---|
| `upgrade` | slug muda; UUID/`enabled`/`layer_map` não; snapshot histórico intacto; novo CHECK ativo; unicidade mantida |
| `rerun` | segunda execução não altera nenhuma linha |
| `collision` | aborta com SQLSTATE `23505`, não renomeia nada, não deixa a coluna sem constraint |
| `absent-table` | no-op limpo, sem índice órfão |
| `rollback-roundtrip` | ida e volta restaura o estado byte a byte e o CHECK anterior |

### Fase 3 — frontend

Passa a exibir e enviar apenas `tvg` / `tvg_img`. Já é tolerante na leitura
(`canonicalVisualModel`), então funciona antes ou depois da migration.

### Fase 4 — endurecimento

Em deploy **posterior**, com abas antigas já drenadas, defina no ambiente da
Edge Function:

```
AP_LEGACY_VISUAL_MODEL_INPUT=reject
```

A partir daí `misto` na entrada retorna `MASTER_MODEL_RETIRED` (400). Sem
variável definida, o padrão é `accept` — nenhum deploy vira fase 4 por acidente.

**Esta é uma decisão explícita, não um efeito colateral:** ao entrar na fase 4,
uma aba antiga que reenviar `misto` passa a falhar. Só execute quando isso for
aceitável.

## Rollback

**Postura padrão: forward-only.** Recuperar de um deploy ruim é corrigir para a
frente, não reverter o slug.

O script reverso existe pré-escrito e testado em
`supabase/rollback/20260727120000_rollback_...sql` — fora de
`supabase/migrations/`, para que nenhuma ferramenta o aplique sozinho.

⚠️ **Pré-condição inegociável:** um build de fase 4 **não** consegue endereçar um
master gravado como `misto`. Antes de rodar o rollback do banco, volte a Edge
Function para o build transicional (ou remova `AP_LEGACY_VISUAL_MODEL_INPUT`).
Reverter só o banco quebra o sistema.

## Habilitação de masters

Nunca na mesma janela da migration. Depois de migrar, validar em staging e gerar
uma matéria por (formato × modelo), habilite cliente a cliente com
`supabase/operations/enable_master_render_configs.sql` — SQL puro, transacional
e auto-validado (`ROW_COUNT` exige exatamente 4 linhas).

## Comandos de verificação

```bash
bash tests/master-v1/run-migration-gates.sh        # 5 gates, arquivos reais
bash tests/master-v1/run-sql-contracts.sh          # 12 contratos SQL
node --test --experimental-strip-types tests/master-v1/*.test.mjs
npm run build
```
