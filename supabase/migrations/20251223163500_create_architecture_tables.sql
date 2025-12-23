
-- 1. Create empresa_profissionais table (Mapping Empresas concept to Clientes table)
CREATE TABLE IF NOT EXISTS public.empresa_profissionais (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    empresa_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES public.profissionais(id) ON DELETE CASCADE,
    funcao TEXT NOT NULL,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(empresa_id, profissional_id, funcao)
);

-- Enable RLS
ALTER TABLE public.empresa_profissionais ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can do everything on empresa_profissionais"
    ON public.empresa_profissionais
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profissionais
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Professionals can view their own links"
    ON public.empresa_profissionais
    FOR SELECT
    USING (
        profissional_id = auth.uid()
    );

-- 2. Create tarefas_itens table
CREATE TABLE IF NOT EXISTS public.tarefas_itens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tarefa_id UUID NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES public.profissionais(id),
    funcao_snapshot TEXT NOT NULL,
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_progresso', 'concluida')),
    entrega_link TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.tarefas_itens ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can do everything on tarefas_itens"
    ON public.tarefas_itens
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profissionais
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Professionals can view and update their own items"
    ON public.tarefas_itens
    FOR ALL
    USING (
        profissional_id = auth.uid()
    );

-- 3. Ensure tarefas has empresa_id linked to Clientes
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tarefas' AND column_name = 'empresa_id') THEN
        ALTER TABLE public.tarefas ADD COLUMN empresa_id UUID REFERENCES public.clientes(id);
    END IF;
END $$;
