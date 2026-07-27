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
frente, não reverter o slug. O script reverso existe pré-escrito e testado em
`supabase/rollback/20260727120000_rollback_...sql` — fora de
`supabase/migrations/`, para que nenhuma ferramenta o aplique sozinho.

### 🚫 Rollback somente do banco é proibido

Reverter o schema é uma **operação coordenada**, não um `UPDATE`. O sistema só é
consistente em combinações inteiras de schema + Edge Function + frontend +
variável de ambiente:

| Schema | Edge Function | `AP_LEGACY_VISUAL_MODEL_INPUT` | Frontend | Estado |
|---|---|---|---|---|
| `misto` | transicional | `accept` | qualquer | ✅ fase 1 |
| `tvg_img` | transicional | `accept` | qualquer | ✅ fases 2–3 |
| `tvg_img` | transicional | `reject` | novo | ✅ fase 4 |
| `misto` | transicional | `accept` | novo | ✅ alvo válido de rollback |
| **`misto`** | **transicional** | **`reject`** | qualquer | ❌ **quebra** |
| **`misto`** | **build antigo pré-fase-1** | — | novo | ❌ **quebra** |

**Ordem obrigatória para reverter o banco:**

1. remova `AP_LEGACY_VISUAL_MODEL_INPUT` (ou defina `accept`) e confirme que a
   Edge Function em execução é o build transicional;
2. valide que uma geração ainda funciona;
3. só então rode o script reverso;
4. valide de novo.

Inverter 1 e 3 derruba a geração: um build de fase 4 **não** consegue endereçar
um master gravado como `misto`.

## Homologação em staging

A ordem é a mesma das fases; nenhum gate pode ser antecipado.

### Gate 1 — fase 1 **antes** da migration

O gate mais importante: prova que a compatibilidade é invariante, não sorte.
Banco ainda com `misto`, apenas a Edge Function transicional publicada com
`AP_LEGACY_VISUAL_MODEL_INPUT=accept`.

- [ ] lookup encontra o master armazenado como `misto`
- [ ] snapshot novo persiste `visual_model = tvg_img`
- [ ] **nenhuma** matéria nova persiste `misto`
- [ ] retry reutiliza o snapshot sem reinterpretação
- [ ] Feed e Reels funcionam
- [ ] TVG e TVG + IMG funcionam
- [ ] tenant com `misto` + `tvg_img` duplicados falha fechado
- [ ] nenhuma linha arbitrária é escolhida

Consulta de verificação:

```sql
SELECT id, content_type,
       render_snapshot ->> 'visual_model' AS snapshot_model,
       render_snapshot -> 'master_config' ->> 'visual_model' AS master_model
FROM ap.candidate_news
WHERE render_contract_version = 'master_v1'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC;
-- Nenhuma linha pode trazer 'misto' em qualquer das duas colunas.
```

### Gate 2 — migration em staging

Capture **antes**:

```sql
SELECT cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map
FROM ap.master_render_configs
ORDER BY cliente_id, content_type, visual_model;
```

Confirme **depois**:

- [ ] nenhuma linha `misto`
- [ ] todas as antigas viraram `tvg_img`
- [ ] UUIDs preservados
- [ ] `enabled` preservado
- [ ] `layer_map` preservado
- [ ] nenhuma linha adicional; nenhum tenant perdeu configuração
- [ ] constraint final é `CHECK (visual_model IN ('tvg','tvg_img'))`
- [ ] reexecução é no-op

### Gate 3 — frontend em staging

- [ ] opções `TVG` e `TVG + IMG`
- [ ] troca Feed → Reels atualiza as opções
- [ ] seleção incompatível é limpa
- [ ] opção única é selecionada automaticamente
- [ ] duas opções exigem decisão
- [ ] payload envia somente o slug canônico
- [ ] mensagem de patrocinadores insuficientes aparece
- [ ] falha de leitura do pool **não** bloqueia indevidamente
- [ ] backend continua sendo a autoridade

### Gate 4 — rejeição explícita do legado

Só depois de migration + frontend estabilizados:
`AP_LEGACY_VISUAL_MODEL_INPUT=reject`.

- [ ] `misto` retorna `400` com `MASTER_MODEL_RETIRED`
- [ ] nenhuma criação parcial; nenhuma linha de candidato nova; nenhum snapshot novo
- [ ] telemetria registra a tentativa
- [ ] o bundle atual segue funcionando normalmente

## Estado do Supabase local durante a validação

Durante os testes foram aplicadas localmente:

- `20260726165558` — grants de `service_role`, **anteriormente ausente** no banco
  local (era essa lacuna, e não o diff deste PR, que fazia
  `master-config-service-role-grants.sql` falhar);
- `20260727120000` — renomeação de `misto` para `tvg_img`.

O banco local foi usado para validar upgrade, rollback e re-upgrade. Portanto,
**seu estado atual não representa mais o baseline anterior à migration**. Isso
está registrado de propósito: o objetivo não é deixar o ambiente "bonito", é
deixá-lo conhecido e reproduzível.

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
