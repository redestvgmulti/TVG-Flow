# Ferramentas ativas

## Doctor

Execute `npm run doctor` para checagens rápidas de configuração e riscos conhecidos de WSoD.

- `npm run doctor -- --build`: inclui a compilação de produção.
- `npm run doctor -- --lint`: inclui o lint.
- `npm run doctor -- --dev`: valida o módulo virtual PWA no servidor em `127.0.0.1:5173`.
- `npm run doctor -- --full`: executa build e lint.

O doctor não mostra valores de variáveis de ambiente e não altera banco, Storage ou dados de usuários.
