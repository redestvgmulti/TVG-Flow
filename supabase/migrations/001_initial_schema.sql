-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TVG Flow - Schema Inicial
-- Criação de todas as tabelas principais do sistema
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Tabela: clientes
-- Armazena os clientes da agência
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela: departamentos
-- Armazena os departamentos da agência
CREATE TABLE IF NOT EXISTS departamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  cor_hex TEXT DEFAULT '#6366f1',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela: profissionais
-- Armazena os profissionais (admin e profissionais)
-- Vinculado ao auth.users do Supabase
CREATE TABLE IF NOT EXISTS profissionais (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  departamento_id UUID REFERENCES departamentos(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'profissional')),
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela: tarefas
-- Armazena todas as tarefas/demandas do sistema
CREATE TABLE IF NOT EXISTS tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  departamento_id UUID REFERENCES departamentos(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profissionais(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profissionais(id) ON DELETE SET NULL,
  deadline TIMESTAMP WITH TIME ZONE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'overdue')),
  em_atraso_desde TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Tabela: arquivos_tarefas
-- Armazena links do Google Drive relacionados às tarefas
CREATE TABLE IF NOT EXISTS arquivos_tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID REFERENCES tarefas(id) ON DELETE CASCADE,
  research_drive_link TEXT,
  final_drive_link TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela: push_subscriptions
-- Armazena as subscriptions de push notifications dos profissionais
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id UUID REFERENCES profissionais(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela: logs_tarefas
-- Armazena o histórico de alterações nas tarefas (auditoria)
CREATE TABLE IF NOT EXISTS logs_tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID REFERENCES tarefas(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES profissionais(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  dados_anteriores JSONB,
  dados_novos JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- ÍNDICES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Índices para melhorar performance de queries
CREATE INDEX IF NOT EXISTS idx_tarefas_assigned_to ON tarefas(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tarefas_created_by ON tarefas(created_by);
CREATE INDEX IF NOT EXISTS idx_tarefas_status ON tarefas(status);
CREATE INDEX IF NOT EXISTS idx_tarefas_deadline ON tarefas(deadline);
CREATE INDEX IF NOT EXISTS idx_tarefas_departamento ON tarefas(departamento_id);
CREATE INDEX IF NOT EXISTS idx_profissionais_departamento ON profissionais(departamento_id);
CREATE INDEX IF NOT EXISTS idx_profissionais_role ON profissionais(role);
CREATE INDEX IF NOT EXISTS idx_logs_tarefas_tarefa_id ON logs_tarefas(tarefa_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profissional ON push_subscriptions(profissional_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMENTÁRIOS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE clientes IS 'Clientes da agência TVG';
COMMENT ON TABLE departamentos IS 'Departamentos da agência (ex: Design, Conteúdo, Social Media)';
COMMENT ON TABLE profissionais IS 'Profissionais da agência (admins e profissionais)';
COMMENT ON TABLE tarefas IS 'Tarefas/demandas do sistema';
COMMENT ON TABLE arquivos_tarefas IS 'Links do Google Drive relacionados às tarefas';
COMMENT ON TABLE push_subscriptions IS 'Subscriptions de push notifications';
COMMENT ON TABLE logs_tarefas IS 'Histórico de alterações nas tarefas (auditoria)';
