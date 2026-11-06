# Correção do conflito editorial — 06/11/2026

## Alteração

A migration `20261106182906_editorial_revision_conflict_http409.sql` muda somente o SQLSTATE de `EDITORIAL_REVISION_CONFLICT` de `40001` para `PT409`, nas cinco assinaturas editoriais ativas. Ela usa as definições existentes, possui validação de alvo e limites de duração/bloqueio, preserva permissões e pode ser reaplicada sem alterar novamente as funções.

O assistente compara a revisão efetivamente aberta pelo autor antes de finalizar e impede sobreposição entre salvar e finalizar, inclusive antes da atualização do estado React. Quando encontra conflito, mantém os campos locais, carrega a versão salva para comparação e bloqueia gravações até uma escolha explícita. Usar o texto remoto ou continuar com o local não salva automaticamente. Se outra sessão voltar a alterar o artigo, a comparação de revisão continua protegendo a gravação seguinte.

Foi removido o workflow `.github/workflows/process-notifications.yml`, origem encontrada para a chamada `curl` à Edge Function inexistente. Antes da remoção, foi confirmado que o job `process-notification-queue` está ativo em produção e chama o processador SQL da fila. O processamento existente de notificações não foi substituído nem executado como teste.

## Validação local

- 57 testes de contrato, reducer, formulário, preparação de IA e recuperação de conflito aprovados.
- 6 testes de integração aprovados em Postgres 17 local e PostgREST oficial 13.0.4, sem registros reais.
- Duas gravações HTTP simultâneas: um HTTP 200, um HTTP 409 (`PT409` / `EDITORIAL_REVISION_CONFLICT`) e uma única revisão persistida. Nova tentativa obsoleta retorna outro HTTP 409 prontamente.
- Fluxos legado e v2: revisões corretas salvam/finalizam/aprovam; conflitos não gravam; repetição idempotente não duplica revisões.
- Permissões, dono e configuração das cinco funções comparados antes/depois; sem diferença além do SQLSTATE. Acesso anônimo, outro autor sem permissão e outro tenant continuam rejeitados.
- Testes do assistente executam sua orquestração real com serviços locais simulados: preservação de texto, comparação indisponível/repetição de leitura, escolha explícita de versão, conflito na finalização, exclusão mútua e continuação normal até o envio para render.
- ESLint dos arquivos alterados e build de produção aprovados. O build mantém o aviso já existente sobre tamanho de bundle e dados antigos do Browserslist.
- Novo workflow de CI reproduz os testes com Postgres/PostgREST isolados, lint e build, sem credenciais de produção.

O binário Windows do PostgREST precisou das DLLs do PostgreSQL no PATH do processo de teste. Isso não é uma configuração da aplicação nem altera produção.

## Publicação

Publicação e verificação remotas serão registradas após execução, com referência ao PR, migration e commit servidos. A auditoria original em `relatorio.md` descreve o estado anterior à correção.

## Limites

Os testes de orquestração do assistente não são uma sessão autenticada em navegador real. Não foram usadas matérias de produção como fixtures, nem acionadas geração de IA, renderização ou publicação real para teste. Os timeouts e as desconexões do Realtime serão comparados após a correção; a auditoria não estabeleceu que todos tenham a mesma causa.
