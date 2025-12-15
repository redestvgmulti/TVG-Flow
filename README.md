# TVG Flow - Sistema de Gestão Operacional

Sistema interno de gestão operacional para agência de marketing TVG. Um centro de comando operacional focado em tarefas, prazos, pessoas e controle.

## 🚀 Stack Tecnológica

- **Frontend**: React + Vite
- **Backend**: Supabase (Auth, Database, Realtime, Edge Functions)
- **Deploy**: Vercel
- **Notificações**: Push API + Service Worker

## 📋 Pré-requisitos

- Node.js 18+ (recomendado 20+)
- npm ou yarn
- Conta no Supabase

## 🛠️ Instalação

1. Clone o repositório:
```bash
cd "TVG Flow"
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env.local
```

Edite `.env.local` com suas credenciais do Supabase:
```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key
```

4. Execute as migrations no Supabase:
   - Acesse o painel do Supabase
   - Vá em SQL Editor
   - Execute os arquivos em `supabase/migrations/` na ordem

5. Inicie o servidor de desenvolvimento:
```bash
npm run dev
```

6. Acesse http://localhost:5173

## 📁 Estrutura do Projeto

```
TVG Flow/
├── public/                 # Arquivos públicos
├── src/
│   ├── assets/
│   │   └── styles/        # Design system (CSS)
│   ├── components/
│   │   ├── common/        # Componentes reutilizáveis
│   │   ├── layout/        # Layout components
│   │   └── tasks/         # Componentes de tarefas
│   ├── contexts/          # React contexts
│   ├── hooks/             # Custom hooks
│   ├── pages/
│   │   ├── auth/          # Páginas de autenticação
│   │   ├── admin/         # Páginas admin
│   │   └── profissional/  # Páginas profissional
│   ├── routes/            # Configuração de rotas
│   ├── services/          # Serviços (Supabase, API)
│   └── utils/             # Utilitários
├── supabase/
│   ├── migrations/        # Migrations SQL
│   └── functions/         # Edge Functions
└── README.md
```

## 🔐 Autenticação

O sistema possui dois tipos de usuários:

### Admin
- Visão 360º de tudo
- CRUD completo de profissionais, departamentos, clientes e tarefas
- Dashboards e relatórios
- Gestão de prazos e atribuições

### Profissional
- Visualiza apenas tarefas atribuídas
- Pode marcar tarefas como concluídas
- Pode criar solicitações para outros profissionais
- Calendário pessoal

## 🗄️ Modelo de Dados

### Tabelas Principais

- **clientes**: Clientes da agência
- **departamentos**: Departamentos (Design, Conteúdo, etc.)
- **profissionais**: Usuários do sistema
- **tarefas**: Tarefas/demandas
- **arquivos_tarefas**: Links do Google Drive
- **push_subscriptions**: Subscriptions de notificações
- **logs_tarefas**: Auditoria de alterações

## 🔔 Notificações Push

O sistema envia notificações push para:
- Nova tarefa criada
- Tarefa atribuída
- Prazo se aproximando (2h antes)
- Tarefa atrasada
- Tarefa concluída
- Solicitação recebida

## 🎨 Design System

O sistema utiliza um design premium com:
- Glassmorphism
- Gradientes vibrantes
- Micro-animações
- Tipografia Inter
- Paleta de cores profissional
- Componentes reutilizáveis

## 📦 Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev

# Build para produção
npm run build

# Preview da build
npm run preview

# Lint
npm run lint
```

## 🚀 Deploy

### Vercel

1. Conecte seu repositório ao Vercel
2. Configure as variáveis de ambiente
3. Deploy automático a cada push

## 📝 Próximos Passos

- [ ] Implementar dashboards completos
- [ ] Criar sistema de calendário
- [ ] Implementar notificações push
- [ ] Configurar Edge Functions
- [ ] Adicionar testes automatizados
- [ ] Implementar PWA completo

## 🤝 Contribuindo

Este é um projeto interno da TVG. Para contribuir:

1. Crie uma branch para sua feature
2. Faça commit das mudanças
3. Abra um Pull Request

## 📄 Licença

Propriedade da TVG - Todos os direitos reservados

## 🆘 Suporte

Para suporte, entre em contato com a equipe de desenvolvimento.

---

**TVG Flow** - Centro de Comando Operacional para Agências de Marketing
