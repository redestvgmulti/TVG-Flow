


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "ap";


ALTER SCHEMA "ap" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE TYPE "public"."feed_post_status" AS ENUM (
    'draft',
    'published',
    'archived'
);


ALTER TYPE "public"."feed_post_status" OWNER TO "postgres";


CREATE TYPE "public"."feed_post_type" AS ENUM (
    'official_news',
    'emergency_alert',
    'service_update',
    'public_event'
);


ALTER TYPE "public"."feed_post_type" OWNER TO "postgres";


CREATE TYPE "public"."os_evento_tipo" AS ENUM (
    'os_criada',
    'comentario_adicionado',
    'status_alterado',
    'prioridade_alterada',
    'deadline_alterada',
    'profissional_atribuido',
    'profissional_removido',
    'microtask_criada',
    'microtask_concluida',
    'microtask_devolvida',
    'os_excluida',
    'os_convertida_complexa',
    'etapa_adicionada',
    'etapa_removida',
    'prazo_alterado',
    'responsavel_reatribuido',
    'titulo_alterado'
);


ALTER TYPE "public"."os_evento_tipo" OWNER TO "postgres";


COMMENT ON TYPE "public"."os_evento_tipo" IS 'ETAPA 3+4: Tipos de eventos da OS. Core (ETAPA 3): os_criada, comentario_adicionado, status_alterado. Governança (ETAPA 4): os_convertida_complexa, etapa_adicionada/removida, prazo_alterado, responsavel_reatribuido, titulo_alterado, os_excluida';



CREATE TYPE "public"."prioridade_tarefa" AS ENUM (
    'baixa',
    'normal',
    'alta',
    'urgente'
);


ALTER TYPE "public"."prioridade_tarefa" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ap"."get_user_cliente_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT cp.cliente_id
  FROM public.cliente_profissionais cp
  WHERE cp.profissional_id = auth.uid()
    AND cp.ativo = true;
$$;


ALTER FUNCTION "ap"."get_user_cliente_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ap"."match_editorial_documents"("query_embedding" "public"."vector", "p_cliente_id" "uuid", "match_count" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "content" "text", "file_name" "text", "chunk_index" integer, "similarity" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.content,
        d.file_name,
        d.chunk_index,
        1 - (d.embedding <=> query_embedding) AS similarity
    FROM ap.editorial_rag_documents d
    WHERE d.cliente_id = p_cliente_id
      AND d.embedding IS NOT NULL
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


ALTER FUNCTION "ap"."match_editorial_documents"("query_embedding" "public"."vector", "p_cliente_id" "uuid", "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ap"."refund_editorial_tokens"("p_cliente_id" "uuid", "p_tokens_to_refund" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE ap.editorial_limits
  SET monthly_token_used = GREATEST(monthly_token_used - p_tokens_to_refund, 0),
      updated_at         = now()
  WHERE cliente_id = p_cliente_id;
END;
$$;


ALTER FUNCTION "ap"."refund_editorial_tokens"("p_cliente_id" "uuid", "p_tokens_to_refund" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ap"."reserve_editorial_tokens"("p_cliente_id" "uuid", "p_tokens" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE ap.editorial_limits
  SET monthly_token_used = 0,
      last_reset_date    = CURRENT_DATE
  WHERE cliente_id = p_cliente_id
    AND DATE_TRUNC('month', last_reset_date::date) != DATE_TRUNC('month', CURRENT_DATE);

  UPDATE ap.editorial_limits
  SET monthly_token_used = monthly_token_used + p_tokens,
      updated_at         = now()
  WHERE cliente_id              = p_cliente_id
    AND monthly_token_used + p_tokens <= monthly_token_limit;

  IF FOUND THEN
    RETURN TRUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ap.editorial_limits WHERE cliente_id = p_cliente_id) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;


ALTER FUNCTION "ap"."reserve_editorial_tokens"("p_cliente_id" "uuid", "p_tokens" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ap"."select_sponsor"("p_cliente_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM ap.patrocinadores
  WHERE cliente_id = p_cliente_id AND ativo = true
  ORDER BY ultimo_uso_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NOT NULL THEN
    UPDATE ap.patrocinadores SET ultimo_uso_at = NOW() WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "ap"."select_sponsor"("p_cliente_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ap"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "ap"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ap"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "ap"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_feed_post"("p_post_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_cidade_id UUID;
    v_role TEXT;
BEGIN
    v_cidade_id := public.current_cidade_id();
    v_role := auth.jwt() -> 'app_metadata' ->> 'role';

    IF v_role NOT IN ('admin', 'master_admin') THEN
         RAISE EXCEPTION 'Permissão insuficiente.';
    END IF;

    UPDATE public.feed_posts
    SET 
        status = 'archived',
        deleted_at = NOW(),
        updated_by = auth.uid()
    WHERE id = p_post_id 
      AND (cidade_id = v_cidade_id OR v_role = 'master_admin');

    RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."archive_feed_post"("p_post_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_close_meetings"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE reunioes
    SET status = 'realizada'
    WHERE data_fim < NOW()
    AND status IN ('agendada', 'em_andamento')
    AND cancelled_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."auto_close_meetings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_admin_tenant_link"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    default_tenant_id UUID;
BEGIN
    -- Only run if user is ADMIN and ACTIVE
    IF NEW.role = 'admin' AND NEW.ativo = true THEN
        
        -- Check if link already exists
        IF NOT EXISTS (
            SELECT 1 
            FROM empresa_profissionais ep 
            JOIN empresas e ON e.id = ep.empresa_id 
            WHERE ep.profissional_id = NEW.id 
              AND e.empresa_tipo = 'tenant'
              AND ep.ativo = true
        ) THEN
            -- Find default tenant
            SELECT id INTO default_tenant_id
            FROM empresas
            WHERE empresa_tipo = 'tenant' AND ativo = true
            LIMIT 1;

            IF default_tenant_id IS NOT NULL THEN
                -- Create the link safely
                INSERT INTO empresa_profissionais (id, empresa_id, profissional_id, funcao, ativo)
                VALUES (gen_random_uuid(), default_tenant_id, NEW.id, 'Admin Auto-Linked', true);
                
                RAISE NOTICE 'BOOTSTRAP: Auto-linked admin % to tenant %', NEW.email, default_tenant_id;
            ELSE
                RAISE WARNING 'BOOTSTRAP FAILED: No tenant found for admin %', NEW.email;
            END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bootstrap_admin_tenant_link"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_admin_tenant_link_after"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    target_tenant_id UUID;
    link_exists BOOLEAN;
BEGIN
    IF NEW.role NOT IN ('admin', 'super_admin') THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        JOIN empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = NEW.id
          AND ep.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND e.ativo = true
    ) INTO link_exists;

    IF link_exists THEN
        RETURN NEW;
    END IF;

    SELECT id INTO target_tenant_id
    FROM empresas
    WHERE empresa_tipo = 'tenant'
      AND ativo = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF target_tenant_id IS NOT NULL THEN
        INSERT INTO empresa_profissionais (
            profissional_id,
            empresa_id,
            funcao,
            ativo,
            created_at
        ) VALUES (
            NEW.id,
            target_tenant_id,
            'Administração (Bootstrap)',
            true,
            NOW()
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bootstrap_admin_tenant_link_after"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_create_deadline_notifications"("payloads" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    inserted_count INT;
BEGIN
    -- Bulk insert from JSONB array
    INSERT INTO notifications (
        profissional_id,
        tipo,
        mensagem,
        metadata,
        created_at
    )
    SELECT
        (p->>'profissional_id')::UUID,
        'deadline_reminder',
        p->>'message',
        p->'metadata',
        NOW()
    FROM jsonb_to_recordset(payloads) AS p(
        profissional_id TEXT,
        message TEXT,
        metadata JSONB
    );

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'inserted', inserted_count
    );
END;
$$;


ALTER FUNCTION "public"."bulk_create_deadline_notifications"("payloads" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bulk_create_deadline_notifications"("payloads" "jsonb") IS 'Bulk insert for deadline notifications to avoid Edge Function timeouts.';



CREATE OR REPLACE FUNCTION "public"."calcular_sla_micro_tarefa"("p_micro_task_id" "uuid") RETURNS TABLE("micro_task_id" "uuid", "atrasada" boolean, "tempo_atraso_minutos" integer, "status_sla" "text")
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        mt.id AS micro_task_id,
        CASE
            WHEN mt.deadline_at IS NULL THEN FALSE
            WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN TRUE
            WHEN mt.status != 'concluida' AND NOW() > mt.deadline_at THEN TRUE
            ELSE FALSE
        END AS atrasada,
        CASE
            WHEN mt.deadline_at IS NULL THEN NULL
            WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN
                EXTRACT(EPOCH FROM (mt.finished_at - mt.deadline_at)) / 60
            WHEN mt.status != 'concluida' AND NOW() > mt.deadline_at THEN
                EXTRACT(EPOCH FROM (NOW() - mt.deadline_at)) / 60
            ELSE NULL
        END::INTEGER AS tempo_atraso_minutos,
        CASE
            WHEN mt.deadline_at IS NULL THEN 'sem_sla'
            WHEN mt.status = 'concluida' AND mt.finished_at <= mt.deadline_at THEN 'concluida_no_prazo'
            WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN 'concluida_atrasada'
            WHEN NOW() > mt.deadline_at THEN 'atrasada'
            WHEN NOW() > (mt.deadline_at - INTERVAL '2 hours') THEN 'proximo_do_prazo'
            ELSE 'no_prazo'
        END AS status_sla
    FROM tarefas_micro mt
    WHERE mt.id = p_micro_task_id;
END;
$$;


ALTER FUNCTION "public"."calcular_sla_micro_tarefa"("p_micro_task_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calcular_sla_micro_tarefa"("p_micro_task_id" "uuid") IS 'Dynamically calculates SLA status for a micro task. Returns sem_sla if deadline_at IS NULL.';



CREATE OR REPLACE FUNCTION "public"."can_add_micro_tasks"("p_os_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    os_record RECORD;
BEGIN
    -- Apenas admin
    IF NOT is_admin_safe() THEN
        RETURN FALSE;
    END IF;
    
    -- Buscar dados da OS
    SELECT status, has_micro_tasks, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Não pode estar concluída
    IF os_record.status IN ('concluida', 'cancelada') THEN
        RETURN FALSE;
    END IF;
    
    -- Deve ser complexa (ou em processo de conversão)
    IF os_record.has_micro_tasks = FALSE THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."can_add_micro_tasks"("p_os_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_add_micro_tasks"("p_os_id" "uuid", "p_user_id" "uuid") IS 'ETAPA 4: Verifica se p_user_id pode adicionar micro-tasks. Apenas admin, e OS deve ser complexa e não estar concluída';



CREATE OR REPLACE FUNCTION "public"."can_assign_professional"("p_cliente_id" "uuid", "p_profissional_id" "uuid", "p_funcao" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
    v_user_role TEXT;
BEGIN
    -- 1. Role do usuário LOGADO (quem opera a UI)
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();

    -- REGRA A: Função Explícita
    IF EXISTS (
        SELECT 1 FROM public.cliente_profissionais
        WHERE profissional_id = p_profissional_id
          AND cliente_id = p_cliente_id
          AND funcao = p_funcao
          AND ativo = true
    ) THEN
        RETURN TRUE;
    END IF;

    -- REGRA B: Bypass de Admin (Auto-Atribuição)
    IF (v_user_role = 'admin' AND p_profissional_id = auth.uid()) THEN
        -- Validação adicional exigida no prompt:
        -- Verificar se o cliente pertence a uma empresa onde este admin tem vínculo ativo.
        -- (Isso garante que o admin não está se atribuindo a um cliente de outro tenant)
        IF EXISTS (
            SELECT 1 FROM public.clientes c
            JOIN public.empresa_profissionais ep ON ep.empresa_id = c.empresa_id
            WHERE c.id = p_cliente_id
              AND ep.profissional_id = auth.uid()
              AND ep.ativo = true
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."can_assign_professional"("p_cliente_id" "uuid", "p_profissional_id" "uuid", "p_funcao" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_change_deadline"("p_os_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    os_record RECORD;
BEGIN
    -- Buscar dados da OS
    SELECT status, created_by, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Admin sempre pode (se ativa)
    IF is_admin_safe() THEN
        RETURN TRUE;
    END IF;
    
    -- Criador pode se pendente
    IF os_record.created_by = p_user_id 
       AND os_record.status = 'pendente' THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."can_change_deadline"("p_os_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_change_deadline"("p_os_id" "uuid", "p_user_id" "uuid") IS 'ETAPA 4: Verifica se p_user_id pode alterar deadline da OS. Admin sempre pode, Criador apenas se pendente';



CREATE OR REPLACE FUNCTION "public"."can_convert_to_complex"("p_os_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    os_record RECORD;
BEGIN
    -- Apenas admin
    IF NOT is_admin_safe() THEN
        RETURN FALSE;
    END IF;
    
    -- Buscar dados da OS
    SELECT status, has_micro_tasks, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Não pode estar concluída
    IF os_record.status IN ('concluida', 'cancelada') THEN
        RETURN FALSE;
    END IF;
    
    -- Não pode já ser complexa
    IF os_record.has_micro_tasks = TRUE THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."can_convert_to_complex"("p_os_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_convert_to_complex"("p_os_id" "uuid", "p_user_id" "uuid") IS 'ETAPA 4: Verifica se p_user_id pode converter OS em complexa. Apenas admin, e OS não pode estar concluída ou já ser complexa';



CREATE OR REPLACE FUNCTION "public"."can_create_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
    v_user_role TEXT;
    v_cliente_empresa_id UUID;
BEGIN
    -- 1. Identificar Role diretamente na tabela (Source of Truth)
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();

    -- REGRA: Super Admin nunca cria OS
    IF v_user_role = 'super_admin' THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Validação de integridade do Cliente
    SELECT empresa_id INTO v_cliente_empresa_id FROM public.clientes WHERE id = p_cliente_id;
    
    -- Se cliente não existe ou não pertence ao Tenant solicitado -> FALSE
    IF v_cliente_empresa_id IS NULL OR v_cliente_empresa_id != p_empresa_id THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Usuário deve ter vínculo ATIVO com o Tenant solicidado
    PERFORM 1 FROM public.empresa_profissionais
    WHERE profissional_id = auth.uid() 
      AND empresa_id = p_empresa_id 
      AND ativo = true;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."can_create_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_create_workflow_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
    v_user_role TEXT;
    v_cliente_empresa_id UUID;
BEGIN
    -- 1. Identificar Role
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();

    -- REGRA: Apenas Admin cria workflow
    IF v_user_role != 'admin' THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Validação de Cliente (Integridade)
    SELECT empresa_id INTO v_cliente_empresa_id FROM public.clientes WHERE id = p_cliente_id;
    IF v_cliente_empresa_id IS NULL OR v_cliente_empresa_id != p_empresa_id THEN
        RETURN FALSE;
    END IF;

    -- REGRA: Vínculo Ativo com Tenant
    PERFORM 1 FROM public.empresa_profissionais
    WHERE profissional_id = auth.uid() 
      AND empresa_id = p_empresa_id 
      AND ativo = true;
      
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."can_create_workflow_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_delete_os"("p_os_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    os_record RECORD;
    event_count INT;
BEGIN
    -- Buscar dados da OS
    SELECT status, created_by, deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada ou já excluída
    IF os_record IS NULL OR os_record.deleted_at IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Admin sempre pode
    IF is_admin_safe() THEN
        RETURN TRUE;
    END IF;
    
    -- Criador pode se pendente E sem atividade além de os_criada
    IF os_record.created_by = p_user_id 
       AND os_record.status = 'pendente' THEN
        
        -- Contar eventos (além de os_criada)
        SELECT COUNT(*) INTO event_count
        FROM os_eventos
        WHERE os_id = p_os_id
        AND tipo != 'os_criada';
        
        -- Permitir apenas se sem atividade
        IF event_count = 0 THEN
            RETURN TRUE;
        END IF;
    END IF;
    
    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."can_delete_os"("p_os_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_delete_os"("p_os_id" "uuid", "p_user_id" "uuid") IS 'ETAPA 4: Verifica se p_user_id pode excluir OS. Admin sempre pode, Criador apenas se pendente e sem atividade (eventos além de os_criada)';



CREATE OR REPLACE FUNCTION "public"."can_update_os"("p_os_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
    v_role TEXT;
    v_empresa_id UUID;
BEGIN
    SELECT role INTO v_role
    FROM profissionais
    WHERE id = auth.uid();

    -- Super Admin nunca edita OS operacional
    IF v_role = 'super_admin' THEN
        RETURN FALSE;
    END IF;

    -- Descobre empresa da OS
    SELECT empresa_id INTO v_empresa_id
    FROM tarefas
    WHERE id = p_os_id;

    IF v_empresa_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Usuário precisa estar vinculado ao tenant da OS
    RETURN EXISTS (
        SELECT 1
        FROM empresa_profissionais
        WHERE profissional_id = auth.uid()
          AND empresa_id = v_empresa_id
          AND ativo = true
    );
END;
$$;


ALTER FUNCTION "public"."can_update_os"("p_os_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_cliente"("p_cliente_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
    v_user_role TEXT;
BEGIN
    -- Super Admin: Acesso total (evita queries desnecessárias se confiarmos na role, mas vamos checar a role no banco para ter certeza)
    -- Para segurança máxima e evitar função helper implícita, lemos a role:
    SELECT role INTO v_user_role FROM public.profissionais WHERE id = auth.uid();
    
    IF v_user_role = 'super_admin' THEN
        RETURN TRUE;
    END IF;

    -- Staff: Não tem acesso a ver dados "do cliente" (apenas tarefas)
    IF v_user_role = 'staff' THEN
        RETURN FALSE;
    END IF;

    -- Admin: Vê se cliente pertence a um tenant onde ele tem vínculo ativo
    IF v_user_role = 'admin' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.clientes c
            JOIN public.empresa_profissionais ep ON ep.empresa_id = c.empresa_id
            WHERE c.id = p_cliente_id
              AND ep.profissional_id = auth.uid()
              AND ep.ativo = true
        );
    END IF;

    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."can_view_cliente"("p_cliente_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_os"("os_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_created_by UUID;
    v_empresa_id UUID;
    v_status TEXT;
    v_is_authorized BOOLEAN;
BEGIN
    -- 1. Validate existence & Get Context
    SELECT created_by, empresa_id, status 
    INTO v_created_by, v_empresa_id, v_status
    FROM tarefas
    WHERE id = os_id;

    IF v_created_by IS NULL THEN
        RAISE EXCEPTION 'OS not found';
    END IF;

    -- 2. Validate Permissions (Creator OR Tenant Admin)
    -- STRICTLY BLOCK CROSS-TENANT: Admin must be in the specific company
    -- STRICTLY BLOCK SUPER ADMIN: Operational flows are for tenant users only
    v_is_authorized := (
        (v_created_by = auth.uid()) 
        OR 
        (is_admin() AND is_admin_in_empresa(v_empresa_id))
    );

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Permission denied: Only the creator or a company admin can cancel this OS';
    END IF;

    IF v_status = 'cancelada' THEN
        RAISE EXCEPTION 'OS is already cancelled';
    END IF;

    IF v_status = 'concluida' THEN
        RAISE EXCEPTION 'Cannot cancel a completed OS';
    END IF;

    -- 3. Execute Soft Cancel
    UPDATE tarefas
    SET status = 'cancelada',
        updated_at = NOW()
    WHERE id = os_id;

    -- 4. Audit Log
    INSERT INTO logs_tarefas (tarefa_id, usuario_id, acao, dados_anteriores, dados_novos)
    VALUES (os_id, auth.uid(), 'cancel_os', jsonb_build_object('status', v_status), jsonb_build_object('status', 'cancelada'));

END;
$$;


ALTER FUNCTION "public"."cancel_os"("os_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_admin_micro_task_access"("p_micro_task_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- If user is Super Admin, allow immediately
    IF EXISTS (SELECT 1 FROM profissionais WHERE id = auth.uid() AND role = 'super_admin') THEN
        RETURN TRUE;
    END IF;

    -- If user is Admin, check tenant link
    -- This query runs with elevated privileges, ignoring RLS policies
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas_micro tm
        JOIN tarefas t ON tm.tarefa_id = t.id
        JOIN empresa_profissionais ep ON t.empresa_id = ep.empresa_id
        WHERE tm.id = p_micro_task_id
        AND ep.profissional_id = auth.uid()
        AND ep.ativo = true
        AND EXISTS (SELECT 1 FROM profissionais WHERE id = auth.uid() AND role = 'admin')
    );
END;
$$;


ALTER FUNCTION "public"."check_admin_micro_task_access"("p_micro_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_macro_task_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    incomplete_count INTEGER;
BEGIN
    -- Only check if the micro task was just completed
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        -- Count incomplete micro tasks
        SELECT COUNT(*) INTO incomplete_count
        FROM tarefas_micro
        WHERE tarefa_id = NEW.tarefa_id
        AND status != 'concluida';
        
        -- If all micro tasks are complete, mark macro task as complete
        IF incomplete_count = 0 THEN
            -- Update macro task status
            UPDATE tarefas
            SET status = 'concluida',
                updated_at = NOW()
            WHERE id = NEW.tarefa_id;
            
            -- Note: Notifications will be handled by Edge Function
            -- to avoid dependency on usuarios table structure
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_macro_task_completion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_notifications"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    deleted_count INT;
BEGIN
    WITH deleted AS (
        DELETE FROM notifications
        WHERE
            -- 1. Garbage (Soft Deleted > 30 days)
            (cleared_at < NOW() - INTERVAL '30 days')
         OR 
            -- 2. Archive (Read > 90 days)
            (read_at < NOW() - INTERVAL '90 days')
         OR 
            -- 3. Zombies (Created > 1 year)
            (created_at < NOW() - INTERVAL '1 year')
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;

    RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_notifications"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_old_notifications"() IS 'Cleanup policy: 30 days for cleared, 90 days for read, 1 year max retention.';



CREATE OR REPLACE FUNCTION "public"."count_unassigned_tasks"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT COUNT(*)::INTEGER
  FROM tarefas t
  WHERE t.status NOT IN ('concluida', 'cancelada')
  AND NOT EXISTS (
    SELECT 1
    FROM tarefas_micro tm
    WHERE tm.tarefa_id = t.id
    AND tm.profissional_id IS NOT NULL
  );
$$;


ALTER FUNCTION "public"."count_unassigned_tasks"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."count_unassigned_tasks"() IS 'Conta tarefas ativas/pendentes que não possuem nenhuma micro-task atribuída a um profissional. Usado para métrica "Sem Responsável" do Dashboard.';



CREATE OR REPLACE FUNCTION "public"."create_feed_post"("p_tipo" "public"."feed_post_type", "p_titulo" "text", "p_resumo" "text", "p_corpo" "text" DEFAULT NULL::"text", "p_imagem_capa" "text" DEFAULT NULL::"text", "p_link_externo" "text" DEFAULT NULL::"text", "p_link_texto" "text" DEFAULT NULL::"text", "p_agendar_para" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_cidade_id UUID;
    v_user_id UUID;
    v_new_id UUID;
BEGIN
    -- Contexto
    v_user_id := auth.uid();
    v_cidade_id := public.current_cidade_id();
    
    IF v_cidade_id IS NULL THEN
        RAISE EXCEPTION 'Usuário sem cidade definida no token.';
    END IF;

    -- Validar permissão (Apenas Staff)
    IF NOT (SELECT (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'secretario', 'master_admin')) THEN
         RAISE EXCEPTION 'Acesso negado: Apenas staff pode criar posts.';
    END IF;

    -- Insert
    INSERT INTO public.feed_posts (
        cidade_id, tipo, status, titulo, resumo, corpo, imagem_capa, 
        link_externo, link_texto, published_at, created_by
    ) VALUES (
        v_cidade_id, 
        p_tipo, 
        'draft', -- Sempre nasce draft
        p_titulo, 
        p_resumo, 
        p_corpo, 
        p_imagem_capa, 
        p_link_externo, 
        p_link_texto, 
        p_agendar_para, -- Se NULL e for publicar, será setado depois
        v_user_id
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;


ALTER FUNCTION "public"."create_feed_post"("p_tipo" "public"."feed_post_type", "p_titulo" "text", "p_resumo" "text", "p_corpo" "text", "p_imagem_capa" "text", "p_link_externo" "text", "p_link_texto" "text", "p_agendar_para" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_meeting_notification"("p_reuniao_id" "uuid", "p_profissional_id" "uuid", "p_titulo" "text", "p_data_inicio" timestamp with time zone, "p_interval_minutes" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_notification_id UUID;
    v_message TEXT;
    v_tipo TEXT;
    v_titulo_notif TEXT;  -- ✅ Novo: título da notificação
    v_date_str TEXT;
    v_time_str TEXT;
BEGIN
    -- Format date and time for message (DD/MM at HH:MM)
    v_date_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM');
    v_time_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');

    -- Build message and titulo based on interval
    IF p_interval_minutes = 0 THEN
        -- Meeting invite
        v_tipo := 'meeting_created';
        v_titulo_notif := 'Nova reunião';  -- ✅ Título curto
        v_message := format('Você foi incluído na reunião "%s". Data: %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = -1 THEN
        -- Meeting updated
        v_tipo := 'meeting_updated';
        v_titulo_notif := 'Reunião alterada';  -- ✅ Título curto
        v_message := format('Reunião "%s" foi alterada para %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = -2 THEN
        -- Meeting cancelled
        v_tipo := 'meeting_cancelled';
        v_titulo_notif := 'Reunião cancelada';  -- ✅ Título curto
        v_message := format('Reunião "%s" agendada para %s às %s foi cancelada.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = 60 THEN
        -- 60min reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Reunião em 1 hora';  -- ✅ Título curto
        v_message := format('Reunião "%s" começa em 1 hora', p_titulo);
    ELSIF p_interval_minutes = 30 THEN
        -- 30min reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Reunião em 30 minutos';  -- ✅ Título curto
        v_message := format('Reunião "%s" começa em 30 minutos', p_titulo);
    ELSIF p_interval_minutes = 10 THEN
        -- 10min reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Reunião em 10 minutos';  -- ✅ Título curto
        v_message := format('Reunião "%s" começa em 10 minutos', p_titulo);
    ELSE
        -- Generic reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Lembrete de reunião';  -- ✅ Título curto
        v_message := format('Lembrete: Reunião "%s" está próxima', p_titulo);
    END IF;

    -- ✅ IDEMPOTENCY CHECK: Prevent ALL duplicates with robust logic
    -- For REMINDERS (10/30/60): strict deduplication
    IF p_interval_minutes IN (10, 30, 60) THEN
        IF EXISTS (
            SELECT 1 FROM notificacoes 
            WHERE profissional_id = p_profissional_id 
            AND tipo = 'meeting_reminder'
            AND metadata->>'reuniao_id' = p_reuniao_id::TEXT
            AND metadata->>'interval_minutes' = p_interval_minutes::TEXT
        ) THEN
            -- Already sent, skip silently
            RAISE NOTICE 'Notification already sent (reminder %min): reuniao=%, profissional=%', 
                p_interval_minutes, p_reuniao_id, p_profissional_id;
            RETURN NULL;
        END IF;
    -- For INVITES (0): prevent duplicates
    ELSIF p_interval_minutes = 0 THEN
        IF EXISTS (
            SELECT 1 FROM notificacoes 
            WHERE profissional_id = p_profissional_id 
            AND tipo = 'meeting_created' 
            AND metadata->>'reuniao_id' = p_reuniao_id::TEXT
        ) THEN
            RAISE NOTICE 'Notification already sent (invite): reuniao=%, profissional=%', 
                p_reuniao_id, p_profissional_id;
            RETURN NULL;
        END IF;
    -- For CANCELLATIONS (-2): prevent duplicates
    ELSIF p_interval_minutes = -2 THEN
        IF EXISTS (
            SELECT 1 FROM notificacoes 
            WHERE profissional_id = p_profissional_id 
            AND tipo = 'meeting_cancelled'
            AND metadata->>'reuniao_id' = p_reuniao_id::TEXT
        ) THEN
            RAISE NOTICE 'Notification already sent (cancellation): reuniao=%, profissional=%', 
                p_reuniao_id, p_profissional_id;
            RETURN NULL;
        END IF;
    END IF;
    -- Note: For UPDATES (-1), we allow duplicates (meeting might be rescheduled multiple times)

    -- ✅ FIX: Insert notification WITH titulo field
    INSERT INTO notificacoes (
        profissional_id,
        tipo,
        titulo,        -- ✅ ADICIONADO: campo obrigatório
        mensagem,
        metadata,
        lida,
        created_at
    ) VALUES (
        p_profissional_id,
        v_tipo,
        v_titulo_notif,  -- ✅ ADICIONADO: título curto da notificação
        v_message,
        jsonb_build_object(
            'reuniao_id', p_reuniao_id,
            'titulo', p_titulo,
            'data_inicio', p_data_inicio,
            'interval_minutes', p_interval_minutes
        ),
        FALSE,
        NOW()
    )
    ON CONFLICT DO NOTHING  -- ✅ Silently skip if unique index prevents insert
    RETURNING id INTO v_notification_id;

    -- Return ID or NULL if already exists
    RETURN v_notification_id;
END;
$$;


ALTER FUNCTION "public"."create_meeting_notification"("p_reuniao_id" "uuid", "p_profissional_id" "uuid", "p_titulo" "text", "p_data_inicio" timestamp with time zone, "p_interval_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_meeting_notification"("p_reuniao_id" "uuid", "p_profissional_id" "uuid", "p_titulo" "text", "p_data_inicio" timestamp with time zone, "p_interval_minutes" integer) IS 'Creates meeting notifications with idempotency guarantees.
- interval=0: meeting_created (invite) - prevents duplicates
- interval=-1: meeting_updated (rescheduled) - allows duplicates
- interval=-2: meeting_cancelled - prevents duplicates
- interval=10/30/60: meeting_reminder - strict deduplication via index + check
Returns notification ID or NULL if already sent.
FIXED: Now includes titulo field (NOT NULL constraint)';



CREATE OR REPLACE FUNCTION "public"."create_os_with_micro_tasks"("p_empresa_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline_at" timestamp with time zone, "p_workflow_stages" "jsonb", "p_drive_link" "text" DEFAULT NULL::"text", "p_created_by" "uuid" DEFAULT "auth"."uid"(), "p_prioridade" "text" DEFAULT 'normal'::"text", "p_cliente_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_macro_task tarefas%ROWTYPE;
    v_micro_task tarefas_micro%ROWTYPE;
    v_stage JSONB;
    v_ordem INTEGER;
    v_micro_tasks JSONB := '[]'::JSONB;
    v_depends_on_id UUID;
    v_user_role TEXT;
    v_normalized_priority TEXT;
    v_cliente_empresa_id UUID;
    v_stage_prof_id UUID;
    v_stage_funcao TEXT;
BEGIN
    -- 1. IDENTIFICAÇÃO DE ROLE
    SELECT role INTO v_user_role FROM profissionais WHERE id = p_created_by;
    IF NOT FOUND THEN RAISE EXCEPTION 'Usuário solicitante não encontrado.'; END IF;

    -- REGRA 1: Bloqueio de Super Admin
    IF v_user_role = 'super_admin' THEN
        RAISE EXCEPTION 'Super Admin não pode criar Ordens de Serviço. Use uma conta de Admin ou Staff.';
    END IF;

    -- Validações Básicas
    IF p_empresa_id IS NULL OR p_titulo IS NULL OR p_deadline_at IS NULL OR p_created_by IS NULL THEN
        RAISE EXCEPTION 'Campos obrigatórios: empresa_id, titulo, deadline_at, created_by';
    END IF;

    -- REGRA: Cliente Obrigatório
    IF p_cliente_id IS NULL THEN
        RAISE EXCEPTION 'A partir de agora, toda nova OS exige um Cliente (Sub-Entidade) vinculado.';
    END IF;

    -- REGRA: Isolamento Tenant x Cliente
    SELECT empresa_id INTO v_cliente_empresa_id FROM clientes WHERE id = p_cliente_id;
    IF v_cliente_empresa_id IS NULL OR v_cliente_empresa_id != p_empresa_id THEN
         RAISE EXCEPTION 'Violação de Isolamento: O Cliente informado não pertence à Empresa (Tenant) da OS.';
    END IF;
    
    -- Validação de Workflow
    IF p_workflow_stages IS NULL OR jsonb_array_length(p_workflow_stages) = 0 THEN
        RAISE EXCEPTION 'workflow_stages deve conter ao menos 1 etapa';
    END IF;

    -- REGRA 2: Restrição de Staff (Apenas OS Simples)
    IF v_user_role = 'staff' AND jsonb_array_length(p_workflow_stages) > 1 THEN
        RAISE EXCEPTION 'Staff só tem permissão para criar OS Simples (1 etapa). Para workflows complexos, solicite a um Admin.';
    END IF;
    
    -- Permissão no Tenant
    PERFORM 1 FROM empresa_profissionais
    WHERE profissional_id = p_created_by AND empresa_id = p_empresa_id AND ativo = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Permissão negada: Você não tem vínculo ativo com o Tenant %.', p_empresa_id; END IF;

    -- Normalização
    v_normalized_priority := CASE 
        WHEN p_prioridade IN ('baixa', 'normal', 'alta', 'urgente') THEN p_prioridade
        ELSE 'normal'
    END;
    
    -- INSERT MACRO TASK
    INSERT INTO tarefas (
        titulo, descricao, empresa_id, created_by, deadline, 
        status, prioridade, progress, drive_link, cliente_id
    ) VALUES (
        p_titulo, p_descricao, p_empresa_id, p_created_by, p_deadline_at,
        'pendente', v_normalized_priority, 0, p_drive_link, p_cliente_id
    ) RETURNING * INTO v_macro_task;
    
    -- LOOP MICRO TASKS
    FOR v_ordem IN 1..jsonb_array_length(p_workflow_stages) LOOP
        v_stage := p_workflow_stages -> (v_ordem - 1);
        v_stage_prof_id := (v_stage->>'profissional_id')::UUID;
        v_stage_funcao := v_stage->>'funcao';
        
        IF NOT (v_stage ? 'profissional_id' AND v_stage ? 'funcao') THEN
            RAISE EXCEPTION 'Stage % está faltando profissional_id ou funcao', v_ordem;
        END IF;

        -- VALIDAÇÃO CONTEXTUAL DE FUNÇÃO
        -- Admin pode se auto-atribuir (bypass controlado)
        -- Staff e atribuição a terceiros continuam exigindo função explícita

        IF NOT (
            -- Caso 1: Profissional possui função válida no cliente
            EXISTS (
                SELECT 1 FROM cliente_profissionais
                WHERE profissional_id = v_stage_prof_id
                  AND cliente_id = p_cliente_id
                  AND funcao = v_stage_funcao
                  AND ativo = true
            )

            -- Caso 2: Admin se auto-atribuindo
            OR (
                v_user_role = 'admin'
                AND v_stage_prof_id = p_created_by
            )
        ) THEN
            RAISE EXCEPTION
                'Violação de Função: O profissional não possui a função "%" habilitada para este Cliente.',
                v_stage_funcao;
        END IF;

        -- Nota: A validação de "Pertence ao Tenant" já é coberta implicitamente acima:
        -- 1. Se tem cliente_profissionais, o admin só pôde criar esse link se ambos forem do mesmo tenant (RLS).
        -- 2. Se é Admin (bypass), já validamos o vínculo dele com tenant na linha 116.
        
        -- Dependências
        v_depends_on_id := NULL;
        IF v_ordem > 1 THEN
            SELECT id INTO v_depends_on_id
            FROM jsonb_to_recordset(v_micro_tasks) AS x(id UUID, ordem INTEGER)
            WHERE ordem = v_ordem - 1;
        END IF;
        
        -- Insert Micro-task
        INSERT INTO tarefas_micro (
            tarefa_id, profissional_id, funcao, peso, 
            status, depends_on, deadline_at
        ) VALUES (
            v_macro_task.id, v_stage_prof_id, v_stage_funcao, 
            COALESCE((v_stage->>'peso')::INTEGER, 1),
            CASE WHEN v_ordem = 1 THEN 'pendente' ELSE 'bloqueada' END,
            v_depends_on_id, (v_stage->>'deadline_at')::TIMESTAMPTZ
        ) RETURNING * INTO v_micro_task;
        
        v_micro_tasks := v_micro_tasks || jsonb_build_object(
            'id', v_micro_task.id, 'ordem', v_ordem, 'funcao', v_micro_task.funcao,
            'status', v_micro_task.status, 'profissional_id', v_micro_task.profissional_id
        );
        
        INSERT INTO tarefas_micro_logs (tarefa_micro_id, to_profissional_id, acao) 
        VALUES (v_micro_task.id, v_stage_prof_id, 'created');
        
        IF v_micro_task.status = 'pendente' THEN
            INSERT INTO notifications (profissional_id, title, message, type, link, read) 
            VALUES (v_stage_prof_id, 'Nova Etapa', format('Etapa %s na OS: %s', v_micro_task.funcao, p_titulo), 'micro_task_assigned', '/staff/tasks', false);
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object(
        'success', true,
        'mode', 'transactional_rpc_v4_contextual_bypass',
        'macro_task_id', v_macro_task.id,
        'micro_tasks_created', jsonb_array_length(v_micro_tasks)
    );
    
EXCEPTION 
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao criar OS (V4): % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;


ALTER FUNCTION "public"."create_os_with_micro_tasks"("p_empresa_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline_at" timestamp with time zone, "p_workflow_stages" "jsonb", "p_drive_link" "text", "p_created_by" "uuid", "p_prioridade" "text", "p_cliente_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_tenant_db"("p_company_name" "text", "p_cnpj" "text", "p_admin_id" "uuid", "p_admin_name" "text", "p_admin_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    new_company_id UUID;
BEGIN
    -- 1. Create Company
    INSERT INTO empresas (nome, cnpj, status_conta, icp_status, tipo_negocio)
    VALUES (p_company_name, p_cnpj, 'active', 'correct', 'other')
    RETURNING id INTO new_company_id;

    -- 2. Ensure Professional exists (safe default)
    INSERT INTO profissionais (id, nome, email, ativo, role)
    VALUES (p_admin_id, p_admin_name, p_admin_email, true, 'staff')
    ON CONFLICT (id) DO UPDATE
    SET nome = p_admin_name, ativo = true;

    -- 3. Create tenant link ALREADY AS ADMIN
    INSERT INTO empresa_profissionais (
        empresa_id,
        profissional_id,
        funcao,
        ativo
    )
    VALUES (
        new_company_id,
        p_admin_id,
        'admin',
        true
    );

    -- ❌ NO UPDATE profissionais.role HERE
    -- Authority is derived from empresa_profissionais

    RETURN new_company_id;
END;
$$;


ALTER FUNCTION "public"."create_tenant_db"("p_company_name" "text", "p_cnpj" "text", "p_admin_id" "uuid", "p_admin_name" "text", "p_admin_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."criar_notificacoes_evento"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task_title TEXT;
    v_client_name TEXT;
    v_targets UUID[];
    v_payload JSONB;
    v_old_status TEXT;
    v_new_status TEXT;
    v_title TEXT;
    v_message TEXT;
BEGIN
    -- 1. Determine importance
    IF NEW.tipo NOT IN ('comentario_adicionado', 'status_alterado', 'profissional_atribuido') THEN
        RETURN NEW;
    END IF;

    -- 2. Fetch Aggregated Targets (Creator + Assigned + Micro-task Owners)
    --    Exclude self (autor_id)
    SELECT ARRAY_AGG(DISTINCT p.id)
    INTO v_targets
    FROM profissionais p
    INNER JOIN tarefas t ON t.id = NEW.os_id
    WHERE (
        t.created_by = p.id
        OR t.assigned_to = p.id
        OR EXISTS (SELECT 1 FROM tarefas_micro tm WHERE tm.tarefa_id = t.id AND tm.profissional_id = p.id)
    )
    AND p.id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND p.ativo = true;

    IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
        RETURN NEW; -- No one to notify
    END IF;

    -- 3. Fetch Context
    SELECT t.titulo, c.nome
    INTO v_task_title, v_client_name
    FROM tarefas t
    LEFT JOIN clientes c ON c.id = t.cliente_id
    WHERE t.id = NEW.os_id;

    v_task_title := COALESCE(v_task_title, 'Tarefa');
    v_client_name := COALESCE(v_client_name, 'Interno');

    -- 4. Construct Payload Message
    CASE NEW.tipo
        WHEN 'status_alterado' THEN
            v_old_status := COALESCE(NEW.metadata->>'de', '?');
            v_new_status := COALESCE(NEW.metadata->>'para', '?');
            v_title := 'Status atualizado';
            v_message := format('A tarefa "%s" (%s) mudou de "%s" para "%s".', v_task_title, v_client_name, v_old_status, v_new_status);
        
        WHEN 'comentario_adicionado' THEN
            v_title := 'Novo comentário';
            v_message := format('Em "%s": %s', v_task_title, NEW.metadata->>'preview');

        WHEN 'profissional_atribuido' THEN
            v_title := 'Você foi atribuído';
            v_message := format('Você foi atribuído à tarefa "%s" (%s).', v_task_title, v_client_name);
            
        ELSE
            v_title := 'Atualização';
            v_message := v_task_title;
    END CASE;

    -- 5. Insert into Queue
    INSERT INTO notification_queue (
        event_type,
        entity_id,
        entity_type,
        payload
    ) VALUES (
        NEW.tipo::text, -- Cast enum to text
        NEW.os_id,
        'task',
        jsonb_build_object(
            'title', v_title,
            'message', v_message,
            'link', '/admin/tasks',
            'target_ids', v_targets,
            'metadata', NEW.metadata,
            'source_event_id', NEW.id
        )
    );

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."criar_notificacoes_evento"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."criar_notificacoes_evento"() IS 'ETAPA 3 CORE: Cria notificações automaticamente para participantes da OS (exceto autor do evento).';



CREATE OR REPLACE FUNCTION "public"."current_cidade_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'cidade_id')::uuid,
        NULL
    );
$$;


ALTER FUNCTION "public"."current_cidade_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debug_whoami"() RETURNS TABLE("uid" "uuid", "role" "text")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT auth.uid(), p.role
  FROM profissionais p
  WHERE p.id = auth.uid();
$$;


ALTER FUNCTION "public"."debug_whoami"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_admin_role_requires_tenant"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    has_tenant BOOLEAN;
BEGIN
    -- Only validate when PROMOTING to admin (role change TO admin)
    IF NEW.role = 'admin' AND (OLD.role IS NULL OR OLD.role != 'admin') THEN
        
        -- Check if user has active tenant link
        SELECT has_active_tenant_link(NEW.id) INTO has_tenant;

        IF NOT has_tenant THEN
            RAISE EXCEPTION 'TENANT_LINK_REQUIRED: Cannot promote % to admin without active tenant link',
                NEW.email
                USING HINT = 'Create active tenant link in empresa_profissionais before promoting to admin role';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_admin_role_requires_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_admin_tenant_link"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    prof_role TEXT;
    prof_email TEXT;
    has_tenant BOOLEAN;
BEGIN
    -- Get professional role and email
    SELECT role, email INTO prof_role, prof_email
    FROM profissionais
    WHERE id = COALESCE(NEW.profissional_id, OLD.profissional_id);

    -- Only enforce for admins
    IF prof_role IS NULL OR prof_role != 'admin' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- On DELETE or UPDATE to ativo=false: Check if removing last tenant link
    IF (TG_OP = 'DELETE') OR (TG_OP = 'UPDATE' AND NEW.ativo = false AND OLD.ativo = true) THEN
        -- Count remaining active tenant links AFTER this operation
        SELECT EXISTS (
            SELECT 1
            FROM empresa_profissionais ep
            JOIN empresas e ON e.id = ep.empresa_id
            WHERE ep.profissional_id = OLD.profissional_id
              AND ep.ativo = true
              AND e.empresa_tipo = 'tenant'
              AND e.ativo = true
              AND ep.id != OLD.id  -- Exclude the row being deleted/deactivated
        ) INTO has_tenant;

        IF NOT has_tenant THEN
            RAISE EXCEPTION 'TENANT_LINK_REQUIRED: Cannot remove last active tenant link for admin % (%). Admins must have at least one active tenant.',
                prof_email, OLD.profissional_id
                USING HINT = 'Deactivate admin role first, or create alternate tenant link before removing this one';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."enforce_admin_tenant_link"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_profissional_on_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO profissionais (id, email, role, ativo)
  VALUES (NEW.id, NEW.email, 'staff', true)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_profissional_on_auth_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_profissional_on_auth_user"() IS 'Automatically creates a professional profile for new Auth users to prevent "zombie" users without roles.';



CREATE OR REPLACE FUNCTION "public"."fix_comment_author_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- If user is authenticated
    IF auth.uid() IS NOT NULL THEN
        -- Allow admin to impersonate (optional, strictly typically admins also use their own ID)
        -- But for safety, we enforce auth.uid() for everyone unless logic dictates otherwise.
        -- Let's check is_admin_safe for exception? NO. 
        -- RLS policy "Criar comentário na OS" STRICTLY requires author_id = auth.uid().
        -- So we MUST set it to auth.uid().
        
        IF NEW.author_id != auth.uid() THEN
            NEW.author_id := auth.uid();
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fix_comment_author_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_is_os_creator"("target_os_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas 
        WHERE id = target_os_id 
        AND created_by = auth.uid()
    );
END;
$$;


ALTER FUNCTION "public"."fn_check_is_os_creator"("target_os_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_is_os_creator_safe"("target_os_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas 
        WHERE id = target_os_id 
        AND created_by = auth.uid()
    );
END;
$$;


ALTER FUNCTION "public"."fn_check_is_os_creator_safe"("target_os_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_check_is_os_participant"("target_os_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM tarefas_micro 
        WHERE tarefa_id = target_os_id
        AND profissional_id = auth.uid()
    );
END;
$$;


ALTER FUNCTION "public"."fn_check_is_os_participant"("target_os_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_empresa_slug_if_missing"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
BEGIN
    -- Only generate if slug is null or empty string
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        -- Generate slug: lowercase, replace non-alphanumeric with hyphen, remove leading/trailing hyphens
        NEW.slug := lower(
            regexp_replace(
                regexp_replace(NEW.nome, '[^a-zA-Z0-9]+', '-', 'g'),
                '(^-|-$)', '', 'g'
            )
        );
        
        -- Fallback for empty result (e.g. if name was only special chars)
        IF NEW.slug IS NULL OR NEW.slug = '' THEN
             NEW.slug := 'empresa-' || gen_random_uuid();
        END IF;
    END IF;

    RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."generate_empresa_slug_if_missing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_protocolo"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Format: YYYYMMDD-HHMISS-RAND
    NEW.protocolo := to_char(now(), 'YYYYMMDD') || '-' || to_char(now(), 'HH24MISS') || '-' || substring(md5(random()::text) from 1 for 4);
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_protocolo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_client_stats"("start_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "end_date" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("client_id" "uuid", "client_name" "text", "total_tasks" bigint, "completed_tasks" bigint, "overdue_tasks" bigint, "avg_resolution_time_hours" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id as client_id,
        c.nome as client_name,
        COUNT(t.id) as total_tasks,
        COUNT(t.id) FILTER (WHERE t.status IN ('completed', 'concluida')) as completed_tasks,
        COUNT(t.id) FILTER (
            WHERE t.status NOT IN ('completed', 'concluida') 
            AND t.deadline < now()
        ) as overdue_tasks,
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (COALESCE(t.completed_at, now()) - t.created_at))/3600
            ) FILTER (WHERE t.status IN ('completed', 'concluida')), 
            0
        )::NUMERIC(10,2) as avg_resolution_time_hours
    FROM clientes c
    LEFT JOIN tarefas t ON t.cliente_id = c.id
    WHERE (start_date IS NULL OR t.created_at >= start_date)
      AND (end_date IS NULL OR t.created_at <= end_date)
    GROUP BY c.id, c.nome
    ORDER BY total_tasks DESC;
END;
$$;


ALTER FUNCTION "public"."get_client_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_companies_stats"() RETURNS TABLE("id" "uuid", "nome" "text", "status_conta" "text", "icp_status" "text", "tipo_negocio" "text", "users_count" bigint, "active_tasks_count" bigint, "created_at" timestamp with time zone, "last_activity_at" timestamp with time zone, "health_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.nome,
        COALESCE(e.status_conta, 'active') as status_conta,
        COALESCE(e.icp_status, 'doubtful') as icp_status,
        e.tipo_negocio,
        0::BIGINT as users_count,  -- Simplified: return 0 to avoid FK errors
        0::BIGINT as active_tasks_count,  -- Simplified: return 0 to avoid FK errors
        e.created_at,
        COALESCE(e.last_activity_at, e.created_at) as last_activity_at,
        CASE
            WHEN COALESCE(e.last_activity_at, e.created_at) > NOW() - INTERVAL '7 days' THEN 'healthy'
            WHEN COALESCE(e.last_activity_at, e.created_at) > NOW() - INTERVAL '14 days' THEN 'low_activity'
            ELSE 'inactive'
        END as health_status
    FROM empresas e
    ORDER BY e.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_companies_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_identity"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
    v_prof public.profissionais%ROWTYPE;
BEGIN
    -- 1. Buscar profissional pelo ID da sessão (auth.uid())
    SELECT * INTO v_prof
    FROM public.profissionais
    WHERE id = auth.uid();

    IF NOT FOUND THEN
        -- Retorna null ou objeto vazio indicando sem perfil
        RETURN jsonb_build_object(
            'has_profile', false,
            'role', 'anon',
            'id', NULL,
            'nome', NULL
        );
    END IF;

    -- 2. Retornar dados essenciais normalizados
    RETURN jsonb_build_object(
        'has_profile', true,
        'id', v_prof.id,
        'nome', v_prof.nome,
        'email', v_prof.email,
        'role', v_prof.role, -- A ÚNICA fonte de verdade para role
        'ativo', v_prof.ativo
    );
END;
$$;


ALTER FUNCTION "public"."get_current_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_chart_data"("days_back" integer DEFAULT 30) RETURNS TABLE("date" "text", "criadas" bigint, "concluidas" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - (days_back - 1),
      CURRENT_DATE,
      '1 day'::interval
    )::DATE as day
  ),
  task_stats AS (
    SELECT
      DATE(created_at) as created_date,
      DATE(completed_at) as completed_date
    FROM tarefas
    WHERE created_at >= CURRENT_DATE - days_back
      AND status != 'cancelada'
  )
  SELECT
    TO_CHAR(ds.day, 'DD/MM') as date,
    COUNT(ts.created_date) FILTER (WHERE ts.created_date = ds.day) as criadas,
    COUNT(ts.completed_date) FILTER (WHERE ts.completed_date = ds.day) as concluidas
  FROM date_series ds
  LEFT JOIN task_stats ts ON TRUE
  GROUP BY ds.day
  ORDER BY ds.day;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_chart_data"("days_back" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_dashboard_chart_data"("days_back" integer) IS 'Retorna dados agregados para o chart do dashboard. Substituiu query client-side que carregava 300-500 registros completos.';



CREATE OR REPLACE FUNCTION "public"."get_dashboard_data"("p_empresa_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_result JSONB;
BEGIN
    -- 1. Security Check: Validate User-Company Link
    IF NOT EXISTS (
        SELECT 1 FROM empresa_profissionais
        WHERE profissional_id = v_user_id AND empresa_id = p_empresa_id
    ) THEN
        RAISE EXCEPTION 'Acesso negado: Usuário não vinculado a esta empresa.';
    END IF;

    -- 2. Build Response
    SELECT jsonb_build_object(
        'summary', (
            SELECT jsonb_build_object(
                'total', COUNT(*),
                'active', COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress', 'pendente', 'em_andamento', 'todo', 'doing')),
                'completed', COUNT(*) FILTER (WHERE status IN ('completed', 'concluida', 'concluído', 'done')),
                'overdue', COUNT(*) FILTER (WHERE deadline < NOW() AND status NOT IN ('completed', 'concluida', 'concluído', 'done'))
            )
            FROM tarefas t
            WHERE t.empresa_id = p_empresa_id
        ),
        'recent_tasks', COALESCE((
            SELECT jsonb_agg(sub)
            FROM (
                SELECT id, titulo, status, priority, deadline, assigned_to, created_at
                FROM tarefas
                WHERE empresa_id = p_empresa_id
                ORDER BY created_at DESC
                LIMIT 5
            ) sub
        ), '[]'::jsonb),
        'tasks_by_status', (
             SELECT jsonb_agg(stats)
             FROM (
                SELECT status, COUNT(*) as count
                FROM tarefas
                WHERE empresa_id = p_empresa_id
                GROUP BY status
             ) stats
        ),
        'productivity', COALESCE((
            SELECT jsonb_agg(prod)
             FROM (
                SELECT 
                    p.id,
                    p.nome,
                    COUNT(t.id) FILTER (WHERE t.status IN ('in_progress', 'em_andamento', 'doing')) as active_count,
                    COUNT(t.id) FILTER (WHERE t.status IN ('completed', 'concluida', 'done')) as completed_count
                FROM profissionais p
                JOIN empresa_profissionais ep ON ep.profissional_id = p.id
                LEFT JOIN tarefas t ON t.assigned_to = p.id AND t.empresa_id = p_empresa_id
                WHERE ep.empresa_id = p_empresa_id
                GROUP BY p.id, p.nome
                ORDER BY p.nome ASC
             ) prod
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_data"("p_empresa_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) RETURNS TABLE("total" bigint, "aberto" bigint, "em_andamento" bigint, "resolvido" bigint, "atrasado" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total,
        COUNT(*) FILTER (WHERE status = 'aberto')::BIGINT as aberto,
        COUNT(*) FILTER (WHERE status = 'em_andamento')::BIGINT as em_andamento,
        COUNT(*) FILTER (WHERE status = 'resolvido')::BIGINT as resolvido,
        COUNT(*) FILTER (WHERE status = 'atrasado')::BIGINT as atrasado
    FROM solicitacoes
    WHERE created_at >= p_start_date AND created_at <= p_end_date;
END;
$$;


ALTER FUNCTION "public"."get_dashboard_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_decrypted_secret"("secret_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'vault', 'public'
    AS $$
DECLARE
  secret_text text;
BEGIN
  SELECT decrypted_secret INTO secret_text
  FROM vault.decrypted_secrets
  WHERE id = secret_id;
  RETURN secret_text;
END;
$$;


ALTER FUNCTION "public"."get_decrypted_secret"("secret_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_institutional_feed"("p_page" integer DEFAULT 1, "p_page_size" integer DEFAULT 10, "p_tipo_filtro" "public"."feed_post_type" DEFAULT NULL::"public"."feed_post_type") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_cidade_id UUID;
    v_offset INTEGER;
    v_total INTEGER;
    v_has_more BOOLEAN;
    v_items JSONB;
BEGIN
    -- 1. Contexto
    v_cidade_id := public.resolve_current_city_id();
    
    IF v_cidade_id IS NULL THEN
        -- Fallback seguro: Retorna vazio ou erro? Para API pública, erro 400 é melhor.
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Tenant context not found. Please provide credentials or strict tenant header.'
        );
    END IF;

    -- 2. Paginação
    p_page := GREATEST(1, p_page);
    p_page_size := GREATEST(1, LEAST(50, p_page_size)); -- Max 50
    v_offset := (p_page - 1) * p_page_size;

    -- 3. Contagem Total (Cachear se possível no front)
    SELECT COUNT(*) INTO v_total
    FROM public.feed_posts
    WHERE cidade_id = v_cidade_id
      AND status = 'published'
      AND deleted_at IS NULL
      AND (tipo = p_tipo_filtro OR p_tipo_filtro IS NULL);

    -- 4. Query Relational -> JSON
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', f.id,
            'tipo', f.tipo,
            'titulo', f.titulo,
            'resumo', f.resumo,
            'imagem_url', f.imagem_capa,
            'data_publicacao', f.published_at,
            'action_link', f.link_externo,
            'action_label', f.link_texto,
            'is_alert', (f.tipo = 'emergency_alert')
        ) ORDER BY f.published_at DESC
    )
    INTO v_items
    FROM (
        SELECT * 
        FROM public.feed_posts
        WHERE cidade_id = v_cidade_id
          AND status = 'published'
          AND deleted_at IS NULL
          AND (tipo = p_tipo_filtro OR p_tipo_filtro IS NULL)
        ORDER BY published_at DESC
        LIMIT p_page_size OFFSET v_offset
    ) f;

    -- 5. Resultado
    v_has_more := (v_offset + p_page_size) < v_total;

    RETURN jsonb_build_object(
        'success', true,
        'data', COALESCE(v_items, '[]'::jsonb),
        'meta', jsonb_build_object(
            'page', p_page,
            'size', p_page_size,
            'total', v_total,
            'has_more', v_has_more,
            'tenant_id', v_cidade_id -- Debug/Confirmation
        )
    );
END;
$$;


ALTER FUNCTION "public"."get_institutional_feed"("p_page" integer, "p_page_size" integer, "p_tipo_filtro" "public"."feed_post_type") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_company_ids"() RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY 
  SELECT ep.empresa_id 
  FROM empresa_profissionais ep 
  WHERE ep.profissional_id = auth.uid() 
  AND ep.ativo = true;
END;
$$;


ALTER FUNCTION "public"."get_my_company_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_os_permissions"("p_os_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    user_id UUID := auth.uid();
    os_record RECORD;
    result JSON;
BEGIN
    -- Buscar dados da OS
    SELECT 
        status, 
        created_by, 
        assigned_to,
        has_micro_tasks,
        deleted_at
    INTO os_record
    FROM tarefas 
    WHERE id = p_os_id;
    
    -- OS não encontrada
    IF os_record IS NULL THEN
        RETURN json_build_object(
            'error', 'OS não encontrada',
            'can_view', false
        );
    END IF;
    
    -- OS excluída
    IF os_record.deleted_at IS NOT NULL THEN
        RETURN json_build_object(
            'error', 'OS excluída',
            'can_view', false,
            'is_deleted', true
        );
    END IF;
    
    -- Calcular permissões
    SELECT json_build_object(
        -- Identificação
        'is_admin', is_admin_safe(),
        'is_creator', os_record.created_by = user_id,
        'is_assigned', os_record.assigned_to = user_id,
        'is_participant', is_os_participant(p_os_id),
        
        -- Estado da OS
        'os_status', os_record.status,
        'is_complex', os_record.has_micro_tasks,
        'is_deleted', os_record.deleted_at IS NOT NULL,
        
        -- Permissões de Visualização
        'can_view', is_os_participant(p_os_id),
        'can_view_timeline', is_os_participant(p_os_id),
        
        -- Permissões de Colaboração
        'can_comment', is_os_participant(p_os_id),
        'can_add_link', (
            is_admin_safe() OR 
            os_record.created_by = user_id OR
            os_record.assigned_to = user_id
        ),
        
        -- Permissões de Execução
        'can_change_status', (
            is_admin_safe() OR 
            (
                (os_record.assigned_to = user_id OR os_record.created_by = user_id)
                AND os_record.status NOT IN ('concluida', 'cancelada')
            )
        ),
        
        -- Permissões de Alteração Leve
        'can_change_title', (
            (is_admin_safe()) OR
            (os_record.created_by = user_id AND os_record.status = 'pendente')
        ),
        'can_change_description', (
            (is_admin_safe()) OR
            (os_record.created_by = user_id AND os_record.status = 'pendente')
        ),
        'can_change_priority', is_admin_safe(),
        'can_change_deadline', can_change_deadline(p_os_id, user_id),
        
        -- Permissões Estruturais
        'can_convert_to_complex', can_convert_to_complex(p_os_id, user_id),
        'can_add_micro_tasks', can_add_micro_tasks(p_os_id, user_id),
        'can_remove_micro_tasks', is_admin_safe(),
        'can_reassign', is_admin_safe(),
        'can_delete', can_delete_os(p_os_id, user_id)
    ) INTO result;
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_os_permissions"("p_os_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_os_permissions"("p_os_id" "uuid") IS 'ETAPA 4: RPC que calcula todas permissões para uma OS. Retorna JSON com flags booleanas para uso no frontend (hooks React). SECURITY DEFINER para usar funções helper';



CREATE OR REPLACE FUNCTION "public"."get_public_metrics"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_cidade_id UUID;
    v_total BIGINT;
    v_resolvidas BIGINT;
    v_em_andamento BIGINT;
    v_tempo_medio_dias NUMERIC(10, 2);
    v_percentual_prazo NUMERIC(5, 2);
BEGIN
    -- 1. Resolve Tenant Context
    v_cidade_id := public.resolve_current_city_id();

    IF v_cidade_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Tenant context not found.'
        );
    END IF;

    -- 2. Calculate Aggregates
    -- Using a single query with FILTER clauses is usually faster than multiple COUNT(*)
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'resolvido'),
        COUNT(*) FILTER (WHERE status IN ('aberto', 'em_andamento')),
        -- Tempo Médio: Apenas resolvidos. Ignora cancelados.
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (data_resolucao - created_at)) / 86400.0
            ) FILTER (WHERE status = 'resolvido'),
            0
        )
    INTO
        v_total,
        v_resolvidas,
        v_em_andamento,
        v_tempo_medio_dias
    FROM public.solicitacoes
    WHERE cidade_id = v_cidade_id
      AND deleted_at IS NULL; -- Soft deleted items excluded strictly

    -- 3. Return Payload
    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'total_solicitacoes', v_total,
            'resolvidas', v_resolvidas,
            'em_andamento', v_em_andamento,
            'tempo_medio_resolucao_dias', ROUND(v_tempo_medio_dias, 1)
        ),
        'meta', jsonb_build_object(
            'tenant_id', v_cidade_id,
            'generated_at', NOW()
        )
    );
END;
$$;


ALTER FUNCTION "public"."get_public_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_role_stats"("start_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "end_date" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("role_name" "text", "total_items" bigint, "completed_items" bigint, "avg_completion_hours" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(d.nome, 'Sem Departamento') as role_name,
        COUNT(ti.id) as total_items,
        COUNT(ti.id) FILTER (WHERE ti.status IN ('completed', 'concluida')) as completed_items,
        COALESCE(
            AVG(
                EXTRACT(EPOCH FROM (COALESCE(ti.concluida_at, now()) - ti.created_at))/3600
            ) FILTER (WHERE ti.status IN ('completed', 'concluida')), 
            0
        )::NUMERIC(10,2) as avg_completion_hours
    FROM tarefas_itens ti
    JOIN profissionais p ON p.id = ti.profissional_id
    LEFT JOIN departamentos d ON d.id = p.departamento_id
    WHERE (start_date IS NULL OR ti.created_at >= start_date)
      AND (end_date IS NULL OR ti.created_at <= end_date)
    GROUP BY d.nome
    ORDER BY total_items DESC;
END;
$$;


ALTER FUNCTION "public"."get_role_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_staff_stats"("start_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "end_date" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("staff_id" "uuid", "staff_name" "text", "total_assigned" bigint, "completed_count" bigint, "overdue_count" bigint, "efficiency_score" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.nome,
        COUNT(ti.id) as total_assigned,
        COUNT(ti.id) FILTER (WHERE ti.status IN ('completed', 'concluida')) as completed_count,
        -- Overdue micro-tasks (if parent task is overdue and micro-task is not done)
        COUNT(ti.id) FILTER (
            WHERE ti.status NOT IN ('completed', 'concluida')
            AND EXISTS (
                SELECT 1 FROM tarefas t 
                WHERE t.id = ti.tarefa_id 
                AND t.deadline < now()
            )
        ) as overdue_count,
        -- Simple efficiency score: (Completed / Total) * 100
        CASE 
            WHEN COUNT(ti.id) > 0 THEN 
                (COUNT(ti.id) FILTER (WHERE ti.status IN ('completed', 'concluida'))::NUMERIC / COUNT(ti.id)::NUMERIC) * 100
            ELSE 0 
        END::NUMERIC(5,2) as efficiency_score
    FROM profissionais p
    JOIN tarefas_itens ti ON ti.profissional_id = p.id
    WHERE (start_date IS NULL OR ti.created_at >= start_date)
      AND (end_date IS NULL OR ti.created_at <= end_date)
    GROUP BY p.id, p.nome
    ORDER BY completed_count DESC;
END;
$$;


ALTER FUNCTION "public"."get_staff_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_super_admin_dashboard_stats"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    result JSON;
    total_tenants INT;
    active_tenants INT;
    suspended_tenants INT;
    growth_data JSON;
    alerts_data JSON;
    summary_text TEXT;
    recent_growth INT;
BEGIN
    -- Security: Only super_admin can execute
    IF NOT EXISTS (
        SELECT 1 FROM profissionais
        WHERE id = auth.uid() AND role = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Super Admin access required';
    END IF;

    -- Total tenants (empresa_tipo = 'tenant' ONLY)
    SELECT COUNT(*) INTO total_tenants
    FROM empresas
    WHERE empresa_tipo = 'tenant';

    -- Active tenants (last 7 days)
    SELECT COUNT(*) INTO active_tenants
    FROM empresas
    WHERE empresa_tipo = 'tenant'
    AND last_activity_at > NOW() - INTERVAL '7 days';

    -- Suspended tenants
    SELECT COUNT(*) INTO suspended_tenants
    FROM empresas
    WHERE empresa_tipo = 'tenant'
    AND status_conta = 'suspended';

    -- Growth data (last 30 days)
    SELECT json_agg(
        json_build_object(
            'date', date_series::date,
            'total', (
                SELECT COUNT(*)
                FROM empresas
                WHERE empresa_tipo = 'tenant'
                AND created_at::date <= date_series::date
            )
        )
        ORDER BY date_series
    ) INTO growth_data
    FROM generate_series(
        CURRENT_DATE - INTERVAL '29 days',
        CURRENT_DATE,
        INTERVAL '1 day'
    ) AS date_series;

    -- Alerts summary
    SELECT json_build_object(
        'critical', (
            SELECT COUNT(*)
            FROM empresas
            WHERE empresa_tipo = 'tenant'
            AND (
                status_conta = 'suspended' OR
                last_activity_at < NOW() - INTERVAL '14 days'
            )
        ),
        'warning', (
            SELECT COUNT(*)
            FROM empresas
            WHERE empresa_tipo = 'tenant'
            AND last_activity_at > NOW() - INTERVAL '14 days'
            AND last_activity_at <= NOW() - INTERVAL '7 days'
        )
    ) INTO alerts_data;

    -- Recent growth (last 30 days)
    SELECT COUNT(*) INTO recent_growth
    FROM empresas
    WHERE empresa_tipo = 'tenant'
    AND created_at > NOW() - INTERVAL '30 days';

    -- Executive summary
    summary_text := total_tenants || ' empresa' || 
                   CASE WHEN total_tenants != 1 THEN 's' ELSE '' END ||
                   ' ativa' || CASE WHEN total_tenants != 1 THEN 's' ELSE '' END ||
                   ' no FlowOS, sistema estável e ' ||
                   CASE WHEN recent_growth > 0 
                       THEN 'crescimento consistente' 
                       ELSE 'sem novos clientes' 
                   END ||
                   ' nos últimos 30 dias.';

    -- Build final result
    result := json_build_object(
        'metrics', json_build_object(
            'totalTenants', total_tenants,
            'activeTenants', active_tenants,
            'suspendedTenants', suspended_tenants,
            'activeRatio', CASE 
                WHEN total_tenants > 0 
                THEN ROUND((active_tenants::decimal / total_tenants * 100), 1)
                ELSE 0 
            END
        ),
        'growthData', growth_data,
        'healthStatus', json_build_object(
            'status', 'healthy',
            'latency', 150
        ),
        'alerts', alerts_data,
        'summary', summary_text
    );

    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_super_admin_dashboard_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_super_admin_dashboard_stats"() IS 'Returns dashboard statistics for Super Admin - TENANT companies only (empresa_tipo = tenant)';



CREATE OR REPLACE FUNCTION "public"."get_tenant_details"("target_company_id" "uuid") RETURNS TABLE("id" "uuid", "nome" "text", "cnpj" "text", "status_conta" "text", "internal_notes" "text", "created_at" timestamp with time zone, "admins_count" bigint, "staff_count" bigint, "admins_list" json, "health_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    calc_health TEXT;
BEGIN
    SELECT 
        CASE
            WHEN e.last_activity_at > NOW() - INTERVAL '7 days' THEN 'healthy'
            WHEN e.last_activity_at > NOW() - INTERVAL '14 days' THEN 'low_activity'
            ELSE 'inactive'
        END INTO calc_health
    FROM empresas e WHERE e.id = target_company_id;

    RETURN QUERY
    SELECT 
        e.id,
        e.nome,
        e.cnpj,
        e.status_conta,
        e.internal_notes,
        e.created_at,
        (
            SELECT COUNT(*) 
            FROM empresa_profissionais ep 
            JOIN profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = e.id AND p.role = 'admin'
        ) as admins_count,
        (
            SELECT COUNT(*) 
            FROM empresa_profissionais ep 
            WHERE ep.empresa_id = e.id
        ) as staff_count,
        (
            SELECT json_agg(json_build_object(
                'id', p.id,
                'nome', p.nome,
                'email', p.email,
                'ativo', p.ativo,
                'role', p.role
            ))
            FROM empresa_profissionais ep
            JOIN profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = e.id AND p.role = 'admin'
        ) as admins_list,
        calc_health as health_status
    FROM empresas e
    WHERE e.id = target_company_id;
END;
$$;


ALTER FUNCTION "public"."get_tenant_details"("target_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_upcoming_meeting_notifications"("interval_minutes" integer) RETURNS TABLE("reuniao_id" "uuid", "profissional_id" "uuid", "profissional_nome" "text", "titulo" "text", "data_inicio" timestamp with time zone, "minutes_until_start" integer, "notification_interval" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id AS reuniao_id,
        rp.profissional_id,
        p.nome AS profissional_nome,
        r.titulo,
        r.data_inicio,
        EXTRACT(EPOCH FROM (r.data_inicio - NOW())) / 60 AS minutes_until_start,
        interval_minutes AS notification_interval
    FROM reunioes r
    INNER JOIN reunioes_participantes rp ON r.id = rp.reuniao_id
    INNER JOIN profissionais p ON rp.profissional_id = p.id
    WHERE 
        -- Only scheduled meetings
        r.status = 'scheduled'
        -- Meeting is in the future
        AND r.data_inicio > NOW()
        -- Meeting is within the notification window
        AND r.data_inicio <= NOW() + MAKE_INTERVAL(mins => interval_minutes)
        -- Meeting is at least close to the notification interval (allow 5min buffer)
        AND r.data_inicio >= NOW() + MAKE_INTERVAL(mins => interval_minutes - 5)
        -- Check if notification not already sent for this interval
        AND NOT EXISTS (
            SELECT 1 FROM notificacoes n
            WHERE n.profissional_id = rp.profissional_id
                AND n.tipo = 'meeting_reminder'
                AND n.metadata->>'reuniao_id' = r.id::TEXT
                AND n.metadata->>'interval_minutes' = interval_minutes::TEXT
                AND n.created_at > NOW() - INTERVAL '2 hours' -- Don't re-notify within 2 hours
        )
    ORDER BY r.data_inicio ASC;
END;
$$;


ALTER FUNCTION "public"."get_upcoming_meeting_notifications"("interval_minutes" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_upcoming_meeting_notifications"("interval_minutes" integer) IS 'Returns meetings that need reminder notifications at specified interval.
Filters out cancelled/completed meetings and already-notified participants.
Participants are notified only for meetings where they are listed.';



CREATE OR REPLACE FUNCTION "public"."get_visible_colleagues"() RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ep_target.profissional_id
  FROM empresa_profissionais ep_target
  WHERE ep_target.empresa_id IN (
    SELECT ep_me.empresa_id
    FROM empresa_profissionais ep_me
    WHERE ep_me.profissional_id = auth.uid()
    AND ep_me.ativo = true
  )
  AND ep_target.ativo = true;
END;
$$;


ALTER FUNCTION "public"."get_visible_colleagues"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profissionais (
    id,
    email,
    nome,
    role,
    ativo,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Usuário'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'profissional'),
    true,
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_active_tenant_link"("prof_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        JOIN empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = prof_id
          AND ep.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND e.ativo = true
    );
$$;


ALTER FUNCTION "public"."has_active_tenant_link"("prof_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_tenant_admin"("target_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN IF target_tenant_id IS NULL THEN RETURN FALSE; END IF; RETURN EXISTS ( SELECT 1 FROM empresa_profissionais ep JOIN profissionais p ON p.id = ep.profissional_id WHERE ep.empresa_id = target_tenant_id AND p.role = 'admin' AND ep.ativo = true ); END; $$;


ALTER FUNCTION "public"."has_tenant_admin"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."identificar_gargalo"("p_tarefa_id" "uuid") RETURNS TABLE("micro_task_id" "uuid", "funcao" "text", "profissional_nome" "text", "tempo_atraso_minutos" integer)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        mt.id AS micro_task_id,
        mt.funcao,
        p.nome AS profissional_nome,
        EXTRACT(EPOCH FROM (NOW() - mt.deadline_at)) / 60 AS tempo_atraso_minutos
    FROM tarefas_micro mt
    INNER JOIN profissionais p ON mt.profissional_id = p.id
    WHERE mt.tarefa_id = p_tarefa_id
      AND mt.deadline_at IS NOT NULL
      AND mt.status != 'concluida'
      AND NOW() > mt.deadline_at
    ORDER BY mt.created_at ASC
    LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."identificar_gargalo"("p_tarefa_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."identificar_gargalo"("p_tarefa_id" "uuid") IS 'Identifies the first overdue, non-completed micro task for a macro task (bottleneck).';



CREATE OR REPLACE FUNCTION "public"."is_active_professional"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profissionais
    WHERE id = auth.uid()
    AND ativo = true
  );
$$;


ALTER FUNCTION "public"."is_active_professional"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_profissional"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profissionais
    WHERE id = auth.uid()
    AND ativo = true
  );
END;
$$;


ALTER FUNCTION "public"."is_active_profissional"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_in_empresa"("empresa_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        INNER JOIN profissionais p ON ep.profissional_id = p.id
        WHERE ep.empresa_id = empresa_uuid
            AND p.id = auth.uid()
            AND p.role = 'admin' 
            AND ep.ativo = TRUE
    );
END;
$$;


ALTER FUNCTION "public"."is_admin_in_empresa"("empresa_uuid" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin_in_empresa"("empresa_uuid" "uuid") IS 'Checks if user is an explicit admin for the specific company. Super Admins are excluded explicitly.';



CREATE OR REPLACE FUNCTION "public"."is_admin_of_tenant"("target_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN IF target_tenant_id IS NULL THEN RETURN FALSE; END IF; RETURN EXISTS ( SELECT 1 FROM empresa_profissionais ep WHERE ep.empresa_id = target_tenant_id AND ep.profissional_id = auth.uid() AND ep.ativo = true ); END; $$;


ALTER FUNCTION "public"."is_admin_of_tenant"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_safe"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN RETURN EXISTS ( SELECT 1 FROM public.profissionais WHERE id = auth.uid() AND role = 'admin' ); END; $$;


ALTER FUNCTION "public"."is_admin_safe"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_meeting_participant"("reuniao_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM reunioes_participantes rp
        WHERE rp.reuniao_id = reuniao_uuid
            AND rp.profissional_id = auth.uid()
    );
END;
$$;


ALTER FUNCTION "public"."is_meeting_participant"("reuniao_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_os_participant"("p_os_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tarefas t
        WHERE t.id = p_os_id
        AND (
            -- Admin vê tudo (usando função safe)
            is_admin_safe()
            OR
            -- Criador da OS
            t.created_by = auth.uid()
            OR
            -- Atribuído direto (OS simples)
            t.assigned_to = auth.uid()
            OR
            -- Atribuído via micro-task (OS complexa)
            EXISTS (
                SELECT 1 FROM tarefas_micro tm
                WHERE tm.tarefa_id = t.id
                AND tm.profissional_id = auth.uid()
            )
        )
    );
END;
$$;


ALTER FUNCTION "public"."is_os_participant"("p_os_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_os_participant"("p_os_id" "uuid") IS 'ETAPA 3: Verifica se usuário autenticado é participante da OS (criador, atribuído direto, ou micro-task). Usa SECURITY DEFINER para evitar recursão RLS.';



CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN RETURN EXISTS ( SELECT 1 FROM public.profissionais WHERE id = auth.uid() AND role = 'super_admin' ); END; $$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_super_admin"() IS 'Canonical check for Super Admin role. Source: public.profissionais.role only.';



CREATE OR REPLACE FUNCTION "public"."log_task_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  history_event text;
begin
  -- Status Change
  if (old.status is distinct from new.status) then
    history_event := 'Status alterado para ' || 
      case 
        when new.status = 'pending' then 'Pendente'
        when new.status = 'in_progress' then 'Em andamento'
        when new.status = 'completed' then 'Concluído'
        else new.status
      end;
      
    insert into public.task_history (task_id, event)
    values (new.id, history_event);
  end if;

  -- Priority Change
  if (old.priority is distinct from new.priority) then
    insert into public.task_history (task_id, event)
    values (new.id, 'Prioridade alterada para ' || new.priority);
  end if;

  -- Deadline Change
  if (old.deadline is distinct from new.deadline) then
    insert into public.task_history (task_id, event)
    values (new.id, 'Prazo atualizado');
  end if;

  -- Assignment Change
  if (old.assigned_to is distinct from new.assigned_to) then
    insert into public.task_history (task_id, event)
    values (new.id, 'Tarefa reatribuída');
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."log_task_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_as_read"("p_profissional_id" "uuid" DEFAULT "auth"."uid"()) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Security guard: Only self or admin can mark as read
    IF p_profissional_id != auth.uid()
       AND NOT EXISTS (
           SELECT 1
           FROM profissionais
           WHERE id = auth.uid()
             AND role = 'admin'
       )
    THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Atomic update for all unread notifications
    UPDATE notifications
    SET read_at = NOW()
    WHERE profissional_id = p_profissional_id
      AND read_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."mark_all_notifications_as_read"("p_profissional_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_all_notifications_as_read"("p_profissional_id" "uuid") IS 'Atomic update to mark all notifications as read for a user.';



CREATE OR REPLACE FUNCTION "public"."notify_admins_and_managers"("p_title" "text", "p_message" "text", "p_link" "text", "p_type" "text", "p_entity_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Insert notification for all active admins and managers
    INSERT INTO notifications (profissional_id, type, title, message, link, entity_id, entity_type, read)
    SELECT 
        id,
        p_type,
        p_title,
        p_message,
        p_link,
        p_entity_id,
        'task',
        false
    FROM profissionais
    WHERE role IN ('admin', 'manager', 'master') -- inclusive list
    AND ativo = true;
END;
$$;


ALTER FUNCTION "public"."notify_admins_and_managers"("p_title" "text", "p_message" "text", "p_link" "text", "p_type" "text", "p_entity_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_meeting_presence"("p_reuniao_id" "uuid", "p_participante_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_reuniao_titulo TEXT;
    v_criador_id UUID;
    v_participante_nome TEXT;
    v_notif_id UUID;
BEGIN
    -- Buscar dados da reunião
    SELECT titulo, criada_por INTO v_reuniao_titulo, v_criador_id
    FROM reunioes WHERE id = p_reuniao_id;
    
    -- Buscar nome do participante
    SELECT nome INTO v_participante_nome
    FROM profissionais WHERE id = p_participante_id;
    
    -- Não notificar se o criador for o próprio participante (auto-confirmação)
    IF v_criador_id = p_participante_id THEN
        RETURN NULL;
    END IF;
    
    IF v_criador_id IS NOT NULL AND v_participante_nome IS NOT NULL THEN
        -- Criar notificação para o CRIADOR
        INSERT INTO notificacoes (
            profissional_id,
            tipo,
            titulo,
            mensagem,
            metadata,
            lida,
            created_at
        ) VALUES (
            v_criador_id,
            'meeting_presence',
            'Presença confirmada',
            format('%s confirmou presença na reunião "%s"', v_participante_nome, v_reuniao_titulo),
            jsonb_build_object(
                'reuniao_id', p_reuniao_id,
                'participante_id', p_participante_id
            ),
            FALSE,
            NOW()
        ) RETURNING id INTO v_notif_id;
        
        RETURN v_notif_id;
    END IF;
    
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."notify_meeting_presence"("p_reuniao_id" "uuid", "p_participante_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."notify_meeting_presence"("p_reuniao_id" "uuid", "p_participante_id" "uuid") IS 'Notifica o criador da reunião quando um participante confirma presença';



CREATE OR REPLACE FUNCTION "public"."notify_task_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Only on INSERT with assigned_to
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL) THEN
    IF EXISTS (SELECT 1 FROM profissionais WHERE id = NEW.assigned_to AND ativo = true) THEN
      INSERT INTO notifications (profissional_id, type, title, message, entity_type, entity_id)
      VALUES (
        NEW.assigned_to, 
        'task_assigned', 
        'Nova Tarefa', 
        'Uma nova tarefa foi atribuída a você: ' || NEW.titulo, 
        'task', 
        NEW.id
      );
    END IF;
  -- Only on UPDATE when assignee changes
  ELSIF (TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL) THEN
    IF EXISTS (SELECT 1 FROM profissionais WHERE id = NEW.assigned_to AND ativo = true) THEN
      INSERT INTO notifications (profissional_id, type, title, message, entity_type, entity_id)
      VALUES (
        NEW.assigned_to, 
        'task_assigned', 
        'Nova Atribuição', 
        'Tarefa atribuída a você: ' || NEW.titulo, 
        'task', 
        NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_task_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_task_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    INSERT INTO notifications (
      profissional_id,
      type,
      title,
      message,
      entity_type,
      entity_id
    )
    SELECT
      id,
      'task_completed',
      'Tarefa concluída',
      NEW.titulo || ' foi concluída',
      'task',
      NEW.id
    FROM profissionais
    WHERE role = 'admin' AND ativo = true;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_task_completion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_task_details_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Check if assigned professional exists and is active
  IF NEW.assigned_to IS NOT NULL AND EXISTS (SELECT 1 FROM profissionais WHERE id = NEW.assigned_to AND ativo = true) THEN
    
    -- Check if the update was made by someone else (avoid self-notification)
    IF auth.uid() IS DISTINCT FROM NEW.assigned_to THEN
      
      -- Detect meaningful changes
      IF (NEW.titulo IS DISTINCT FROM OLD.titulo) OR
         (NEW.descricao IS DISTINCT FROM OLD.descricao) OR
         (NEW.deadline IS DISTINCT FROM OLD.deadline) OR
         (NEW.priority IS DISTINCT FROM OLD.priority) OR
         (NEW.status IS DISTINCT FROM OLD.status) OR
         (NEW.drive_link IS DISTINCT FROM OLD.drive_link) THEN
         
         INSERT INTO notifications (
           profissional_id,
           type,
           title,
           message,
           entity_type,
           entity_id
         )
         VALUES (
           NEW.assigned_to,
           'task_updated',
           'Tarefa Atualizada',
           'A tarefa "' || NEW.titulo || '" foi atualizada.',
           'task',
           NEW.id
         );
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_task_details_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_task_requested"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN IF NEW.requested_by IS NOT NULL AND NEW.area_id IS NOT NULL THEN IF (SELECT p.area_id FROM profissionais p WHERE p.id = NEW.requested_by) IS DISTINCT FROM NEW.area_id THEN INSERT INTO notifications (profissional_id, type, title, message, entity_type, entity_id) SELECT p.id, 'task_requested', 'Nova solicitação recebida', NEW.titulo, 'task', NEW.id FROM profissionais p WHERE p.area_id = NEW.area_id AND p.ativo = true AND p.id != NEW.requested_by; END IF; END IF; RETURN NEW; END; $$;


ALTER FUNCTION "public"."notify_task_requested"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_notification_queue"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_batch_size INT := 100;
    v_queue_record RECORD;
    v_target_ids UUID[];
    v_admin_ids UUID[];
    v_final_targets UUID[];
BEGIN
    -- Cache admins for default behavior
    SELECT ARRAY_AGG(id) INTO v_admin_ids
    FROM profissionais
    WHERE role IN ('admin', 'manager', 'master')
      AND ativo = true;

    -- Process pending queue items
    FOR v_queue_record IN
        SELECT *
        FROM notification_queue
        WHERE status = 'pending'
          AND entity_id IS NOT NULL
        ORDER BY created_at
        LIMIT v_batch_size
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            UPDATE notification_queue
            SET status = 'processing',
                retry_count = retry_count + 1
            WHERE id = v_queue_record.id;

            -- DETERMINE TARGETS (Specific targets > Admins)
            -- Check if payload has 'target_ids'
            IF v_queue_record.payload ? 'target_ids' AND jsonb_array_length(v_queue_record.payload->'target_ids') > 0 THEN
                SELECT ARRAY_AGG(value::uuid) INTO v_target_ids
                FROM jsonb_array_elements_text(v_queue_record.payload->'target_ids');
                v_final_targets := v_target_ids;
            ELSE
                -- Default to admins for macro/micro completion (legacy behavior)
                v_final_targets := v_admin_ids;
            END IF;

            IF v_final_targets IS NULL THEN
                 -- Fallback if no targets found
                 v_final_targets := v_admin_ids;
            END IF;

            -- INSERT NOTIFICATIONS FOR EACH TARGET
            -- 1. MACRO/MICRO COMPLETED (Legacy Types)
            IF v_queue_record.event_type IN ('macro_completed', 'micro_completed', 'micro_returned') THEN
                INSERT INTO notifications (
                    profissional_id, type, title, message, link, entity_id, entity_type, metadata, read_at
                )
                SELECT
                    target_id,
                    CASE v_queue_record.event_type
                        WHEN 'macro_completed' THEN 'macro_task_completed'
                        WHEN 'micro_completed' THEN 'micro_task_completed'
                        WHEN 'micro_returned' THEN 'micro_task_returned'
                    END,
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    v_queue_record.payload->>'link',
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    jsonb_build_object(
                        'created_via', 'queue_processor',
                        'original_event', v_queue_record.event_type,
                        'payload', v_queue_record.payload
                    ),
                    NULL
                FROM UNNEST(v_final_targets) AS target_id
                ON CONFLICT DO NOTHING; -- Simple dedupe

            -- 2. STATUS / COMMENTS / ASSIGNMENT (New Types)
            ELSIF v_queue_record.event_type IN ('status_alterado', 'comentario_adicionado', 'profissional_atribuido') THEN
                INSERT INTO notifications (
                    profissional_id, type, title, message, link, entity_id, entity_type, metadata, read_at
                )
                SELECT
                    target_id,
                    CASE v_queue_record.event_type
                         WHEN 'status_alterado' THEN 'task_status_updated'
                         WHEN 'comentario_adicionado' THEN 'comment_added'
                         WHEN 'profissional_atribuido' THEN 'task_assigned'
                    END,
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    coalesce(v_queue_record.payload->>'link', '/admin/tasks'),
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    v_queue_record.payload, -- Use full payload as metadata for context
                    NULL
                FROM UNNEST(v_final_targets) AS target_id
                ON CONFLICT DO NOTHING;
            END IF;

            -- Mark as completed
            UPDATE notification_queue
            SET status = 'completed',
                processed_at = NOW(),
                error = NULL
            WHERE id = v_queue_record.id;

        EXCEPTION WHEN OTHERS THEN
            UPDATE notification_queue
            SET status = 'failed',
                error = SQLERRM,
                processed_at = NOW()
            WHERE id = v_queue_record.id;
        END;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."process_notification_queue"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."process_notification_queue"() IS 'HARDENED: Zero sensitive data logging. Processes notification queue with idempotency and auto-cleanup.';



CREATE OR REPLACE FUNCTION "public"."publish_feed_post"("p_post_id" "uuid", "p_disparar_push" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_cidade_id UUID;
    v_role TEXT;
    v_post_cidade_id UUID;
BEGIN
    v_cidade_id := public.current_cidade_id();
    v_role := auth.jwt() -> 'app_metadata' ->> 'role';

    -- Validar Role (Secretário NÃO pode publicar)
    IF v_role NOT IN ('admin', 'master_admin') THEN
        RAISE EXCEPTION 'Permissão insuficiente: Requer aprovação de Admin.';
    END IF;

    -- Verificar Propriedade
    SELECT cidade_id INTO v_post_cidade_id FROM public.feed_posts WHERE id = p_post_id;
    
    IF v_post_cidade_id IS DISTINCT FROM v_cidade_id AND v_role <> 'master_admin' THEN
        RAISE EXCEPTION 'Post não pertence à sua cidade.';
    END IF;

    -- Update
    UPDATE public.feed_posts
    SET 
        status = 'published',
        published_at = COALESCE(published_at, NOW()), -- Se já tinha data (agendado), mantém. Senão põe agora.
        updated_by = auth.uid()
    WHERE id = p_post_id;

    -- TODO: Integração com Push Notification aqui (Fila Async)
    -- IF p_disparar_push THEN ... END IF;

    RETURN jsonb_build_object('success', true, 'status', 'published');
END;
$$;


ALTER FUNCTION "public"."publish_feed_post"("p_post_id" "uuid", "p_disparar_push" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_macro_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        INSERT INTO notification_queue (event_type, entity_type, entity_id, payload)
        VALUES (
            'macro_completed',
            'task',
            NEW.id,
            jsonb_build_object(
                'title', 'Tarefa Concluída',
                'message', 'A tarefa macro "' || NEW.titulo || '" foi concluída.',
                'link', '/admin/tasks'
            )
        )
        ON CONFLICT (entity_id, event_type) WHERE status IN ('pending', 'processing') DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_macro_completion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_micro_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task_title TEXT;
    v_prof_name TEXT;
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        SELECT t.titulo, p.nome 
        INTO v_task_title, v_prof_name
        FROM tarefas t, profissionais p
        WHERE t.id = NEW.tarefa_id AND p.id = NEW.profissional_id;

        INSERT INTO notification_queue (event_type, entity_type, entity_id, payload)
        VALUES (
            'micro_completed',
            'micro_task',
            NEW.id,
            jsonb_build_object(
                'title', 'Etapa Concluída',
                'message', 'A etapa "' || NEW.funcao || '" foi concluída por ' || COALESCE(v_prof_name, 'desconhecido') || ' na tarefa "' || COALESCE(v_task_title, 'sem título') || '".',
                'link', '/admin/tasks'
            )
        )
        ON CONFLICT (entity_id, event_type) WHERE status IN ('pending', 'processing') DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_micro_completion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_micro_devolution"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_task_title TEXT;
    v_reason TEXT;
BEGIN
    IF NEW.status = 'devolvida' AND (OLD IS NULL OR OLD.status != 'devolvida') THEN
        SELECT titulo INTO v_task_title 
        FROM tarefas 
        WHERE id = NEW.tarefa_id;
        
        SELECT motivo INTO v_reason 
        FROM tarefas_micro_logs 
        WHERE tarefa_micro_id = NEW.id AND acao = 'returned' 
        ORDER BY created_at DESC 
        LIMIT 1;

        INSERT INTO notification_queue (event_type, entity_type, entity_id, payload)
        VALUES (
            'micro_returned',
            'micro_task',
            NEW.id,
            jsonb_build_object(
                'title', 'Etapa Devolvida',
                'message', 'A etapa "' || NEW.funcao || '" foi devolvida na tarefa "' || COALESCE(v_task_title, 'sem título') || '". Motivo: ' || COALESCE(v_reason, 'Não informado'),
                'link', '/admin/tasks'
            )
        )
        ON CONFLICT (entity_id, event_type) WHERE status IN ('pending', 'processing') DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_micro_devolution"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_alteracoes_tarefa"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_user_id UUID;
    v_dados JSONB;
BEGIN
    -- Tentar identificar o usuário (falha graciosa se não houver sessão)
    BEGIN
        v_user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- 1. Prazo Alterado
    IF (OLD.deadline IS DISTINCT FROM NEW.deadline) THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id, 
            'prazo_alterado', 
            v_user_id,
            jsonb_build_object(
                'de', OLD.deadline,
                'para', NEW.deadline,
                'origem', 'trigger'
            )
        );
    END IF;

    -- 2. Título Alterado
    IF (OLD.titulo IS DISTINCT FROM NEW.titulo) THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id, 
            'titulo_alterado', 
            v_user_id,
            jsonb_build_object(
                'de', OLD.titulo,
                'para', NEW.titulo,
                'origem', 'trigger'
            )
        );
    END IF;

    -- 3. Responsável Reatribuído
    IF (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id, 
            'responsavel_reatribuido', 
            v_user_id,
            jsonb_build_object(
                'de', OLD.assigned_to,
                'para', NEW.assigned_to,
                'origem', 'trigger'
            )
        );
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_alteracoes_tarefa"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_evento_comentario"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Inserir evento na timeline
    INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
    VALUES (
        NEW.task_id, -- task_comments usa 'task_id' como FK
        'comentario_adicionado',
        NEW.author_id, -- ✅ Autor do comentário (campo persistido)
        jsonb_build_object(
            'comentario_id', NEW.id,
            'preview', LEFT(NEW.content, 100) -- Preview de 100 chars
        )
    );
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao registrar evento comentario para task %: %', NEW.task_id, SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_evento_comentario"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_evento_comentario"() IS 'ETAPA 3 CORE: Registra evento comentario_adicionado automaticamente. Usa NEW.author_id.';



CREATE OR REPLACE FUNCTION "public"."registrar_evento_os_criada"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Inserir evento na timeline
    INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
    VALUES (
        NEW.id,
        'os_criada',
        NEW.created_by, -- ✅ Usa campo persistido, NÃO auth.uid()
        jsonb_build_object(
            'titulo', NEW.titulo,
            'prioridade', NEW.prioridade,
            'deadline', NEW.deadline
        )
    );
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log erro mas não bloqueia criação da OS
    RAISE WARNING 'Falha ao registrar evento os_criada para OS %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_evento_os_criada"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_evento_os_criada"() IS 'ETAPA 3 CORE: Registra evento os_criada automaticamente. Usa NEW.created_by (não auth.uid).';



CREATE OR REPLACE FUNCTION "public"."registrar_evento_status_alterado"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Apenas se status mudou de fato
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id,
            'status_alterado',
            NULL, -- ✅ Sistema (não sabemos quem alterou específicamente)
            jsonb_build_object(
                'de', OLD.status,
                'para', NEW.status
            )
        );
    END IF;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao registrar evento status_alterado para OS %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_evento_status_alterado"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_evento_status_alterado"() IS 'ETAPA 3 CORE: Registra evento status_alterado quando status muda. autor_id = NULL (sistema).';



CREATE OR REPLACE FUNCTION "public"."resolve_current_city_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_cidade_id UUID;
    v_claims JSONB;
BEGIN
    -- 1. Tentar via JWT (Usuário Logado)
    v_claims := current_setting('request.jwt.claims', true)::jsonb;
    
    IF v_claims IS NOT NULL AND (v_claims -> 'app_metadata' ->> 'cidade_id') IS NOT NULL THEN
        RETURN (v_claims -> 'app_metadata' ->> 'cidade_id')::uuid;
    END IF;

    -- 2. Tentar via Header 'x-city-os-tenant' (Acesso Público Seguro)
    -- O gateway/frontend deve garantir que este header corresponde ao domínio acessado.
    BEGIN
        v_cidade_id := (current_setting('request.headers', true)::jsonb ->> 'x-city-os-tenant')::uuid;
        IF v_cidade_id IS NOT NULL THEN
            RETURN v_cidade_id;
        END IF;
    EXCEPTION 
        WHEN OTHERS THEN NULL; -- Ignora erros de cast
    END;

    -- Se não encontrou, retorna NULL (RPC deve tratar)
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."resolve_current_city_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_abrir_solicitacao"("p_tipo_solicitacao_id" "uuid", "p_tipo_ocorrencia" "text", "p_titulo" "text", "p_descricao" "text", "p_endereco" "text", "p_latitude" double precision DEFAULT NULL::double precision, "p_longitude" double precision DEFAULT NULL::double precision, "p_foto_url" "text" DEFAULT NULL::"text", "p_idempotency_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
    v_cidade_id UUID;
    v_solicitacao_id UUID;
    v_protocolo TEXT;
    v_novo_status TEXT := 'aberto';
    v_existing_id UUID;
    v_existing_protocolo TEXT;
BEGIN
    -- 1. Get Current User
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: Usuário não autenticado.';
    END IF;

    -- 2. Derive Tenant (Cidade) from User Profile
    -- STRICT isolation: Tenant is never passed by client
    SELECT cidade_id INTO v_cidade_id
    FROM usuarios
    WHERE id = v_user_id;

    IF v_cidade_id IS NULL THEN
        RAISE EXCEPTION 'Erro de consistência: Usuário sem cidade vinculada.';
    END IF;

    -- 3. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, protocolo INTO v_existing_id, v_existing_protocolo
        FROM solicitacoes
        WHERE idempotency_key = p_idempotency_key;

        IF v_existing_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'solicitacao_id', v_existing_id,
                'protocolo', v_existing_protocolo,
                'idempotent', true,
                'message', 'Solicitação já processada anteriormente.'
            );
        END IF;
    END IF;

    -- 4. Validation
    IF p_titulo IS NULL OR length(trim(p_titulo)) < 3 THEN
        RAISE EXCEPTION 'O título é obrigatório e deve ter 3+ caracteres.';
    END IF;

    -- 5. INSERT (Atomic)
    INSERT INTO solicitacoes (
        cidadao_id,
        cidade_id,
        tipo_solicitacao_id,
        tipo_ocorrencia,
        titulo,
        descricao,
        endereco,
        latitude,
        longitude,
        foto_url,
        status,
        idempotency_key,
        created_at,
        updated_at
    )
    VALUES (
        v_user_id,
        v_cidade_id,
        p_tipo_solicitacao_id,
        p_tipo_ocorrencia,
        p_titulo,
        p_descricao,
        p_endereco,
        p_latitude,
        p_longitude,
        p_foto_url,
        v_novo_status,
        p_idempotency_key,
        NOW(),
        NOW()
    )
    RETURNING id, protocolo INTO v_solicitacao_id, v_protocolo;

    -- 6. [INTEGRATION] Feed Automático (Se solicitação pública e não anônima?)
    -- Regra: Criar 'service_update' para nova abertura.
    -- TODO: Verificar se solicitações privadas devem ir para o feed (provavelmente não).
    INSERT INTO feed_posts (
        cidade_id,
        tipo,
        status,
        titulo,
        resumo,
        published_at,
        created_by
    ) VALUES (
        v_cidade_id,
        'service_update',
        'published',
        'Nova Solicitação: ' || p_titulo,
        'Protocolo ' || v_protocolo || ': ' || substring(p_descricao from 1 for 100) || '...',
        NOW(),
        v_user_id
    );

    -- 6. Return audit payload
    RETURN jsonb_build_object(
        'success', true,
        'solicitacao_id', v_solicitacao_id,
        'protocolo', v_protocolo,
        'idempotent', false
    );
END;
$$;


ALTER FUNCTION "public"."rpc_abrir_solicitacao"("p_tipo_solicitacao_id" "uuid", "p_tipo_ocorrencia" "text", "p_titulo" "text", "p_descricao" "text", "p_endereco" "text", "p_latitude" double precision, "p_longitude" double precision, "p_foto_url" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_adicionar_anexo"("p_solicitacao_id" "uuid", "p_url" "text", "p_tipo" "text", "p_nome" "text", "p_tamanho" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
    v_user_role TEXT;
    v_user_cidade_id UUID;
    v_solicitacao_cidade_id UUID;
    v_solicitacao_cidadao_id UUID;
    v_anexo_id UUID;
BEGIN
    -- 1. Get User Context
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: Usuário não autenticado.';
    END IF;

    SELECT tipo_perfil, cidade_id 
    INTO v_user_role, v_user_cidade_id
    FROM usuarios
    WHERE id = v_user_id;

    -- 2. Get Resource Context
    SELECT cidade_id, cidadao_id
    INTO v_solicitacao_cidade_id, v_solicitacao_cidadao_id
    FROM solicitacoes
    WHERE id = p_solicitacao_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitação não encontrada.';
    END IF;

    -- 3. PERMISSION CHECK
    IF v_user_role = 'cidadao' THEN
        -- Citizens can only attach to their own requests
        IF v_solicitacao_cidadao_id != v_user_id THEN
            RAISE EXCEPTION 'Acesso negado: Você só pode adicionar anexos em suas próprias solicitações.';
        END IF;
    ELSIF v_user_role IN ('admin', 'secretario', 'master_admin') THEN
         -- Must match City
        IF v_user_role != 'master_admin' AND v_user_cidade_id != v_solicitacao_cidade_id THEN
             RAISE EXCEPTION 'Acesso negado: Este recurso pertence a outra cidade.';
        END IF;
    END IF;

    -- 4. INSERT
    INSERT INTO anexos (
        solicitacao_id,
        usuario_id,
        url,
        tipo,
        nome,
        tamanho,
        created_at
    ) VALUES (
        p_solicitacao_id,
        v_user_id,
        p_url,
        p_tipo,
        p_nome,
        p_tamanho,
        NOW()
    )
    RETURNING id INTO v_anexo_id;

    -- 5. Return Success
    RETURN jsonb_build_object(
        'success', true,
        'id', v_anexo_id,
        'url', p_url
    );
END;
$$;


ALTER FUNCTION "public"."rpc_adicionar_anexo"("p_solicitacao_id" "uuid", "p_url" "text", "p_tipo" "text", "p_nome" "text", "p_tamanho" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_adicionar_comentario"("p_solicitacao_id" "uuid", "p_texto" "text", "p_interno" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
    v_user_role TEXT;
    v_user_cidade_id UUID;
    v_solicitacao_cidade_id UUID;
    v_solicitacao_cidadao_id UUID;
    v_comment_id UUID;
BEGIN
    -- 1. Get User Context
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: Usuário não autenticado.';
    END IF;

    SELECT tipo_perfil, cidade_id 
    INTO v_user_role, v_user_cidade_id
    FROM usuarios
    WHERE id = v_user_id;

    -- 2. Get Resource Context
    SELECT cidade_id, cidadao_id
    INTO v_solicitacao_cidade_id, v_solicitacao_cidadao_id
    FROM solicitacoes
    WHERE id = p_solicitacao_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitação não encontrada.';
    END IF;

    -- 3. PERMISSION CHECK
    IF v_user_role = 'cidadao' THEN
        -- Citizens can only comment on THEIR requests and CANNOT mark as internal
        IF v_solicitacao_cidadao_id != v_user_id THEN
            RAISE EXCEPTION 'Acesso negado: Você só pode comentar em suas próprias solicitações.';
        END IF;
        IF p_interno IS TRUE THEN
            RAISE EXCEPTION 'Acesso negado: Cidadãos não podem criar comentários internos.';
        END IF;
    
    ELSIF v_user_role IN ('admin', 'secretario', 'master_admin') THEN
        -- Admins must match City (Master matches all)
        IF v_user_role != 'master_admin' AND v_user_cidade_id != v_solicitacao_cidade_id THEN
             RAISE EXCEPTION 'Acesso negado: Este recurso pertence a outra cidade.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Perfil de usuário desconhecido.';
    END IF;

    -- 4. INSERT
    INSERT INTO comentarios (
        solicitacao_id,
        autor_id,
        texto,
        interno,
        autor_tipo,
        created_at
    ) VALUES (
        p_solicitacao_id,
        v_user_id,
        p_texto,
        p_interno,
        v_user_role,
        NOW()
    )
    RETURNING id INTO v_comment_id;

    -- 5. Return Success
    RETURN jsonb_build_object(
        'success', true,
        'id', v_comment_id
    );
END;
$$;


ALTER FUNCTION "public"."rpc_adicionar_comentario"("p_solicitacao_id" "uuid", "p_texto" "text", "p_interno" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_atualizar_status_solicitacao"("p_solicitacao_id" "uuid", "p_novo_status" "text", "p_observacao_historico" "text", "p_comentario_resolucao" "text" DEFAULT NULL::"text", "p_fotos_resolucao" "text"[] DEFAULT NULL::"text"[], "p_comentario_adicional" "text" DEFAULT NULL::"text", "p_interno" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
    v_user_role TEXT;
    v_user_cidade_id UUID;
    v_user_secretaria_id UUID;
    v_solicitacao_cidade_id UUID;
    v_solicitacao_secretaria_id UUID;
    v_current_status TEXT;
BEGIN
    -- 1. Get User Context
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: Usuário não autenticado.';
    END IF;

    SELECT tipo_perfil, cidade_id, secretaria_id 
    INTO v_user_role, v_user_cidade_id, v_user_secretaria_id
    FROM usuarios
    WHERE id = v_user_id;

    -- 2. Get Resource Context
    SELECT cidade_id, secretaria_id, status 
    INTO v_solicitacao_cidade_id, v_solicitacao_secretaria_id, v_current_status
    FROM solicitacoes
    WHERE id = p_solicitacao_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Solicitação não encontrada.';
    END IF;

    -- 3. PERMISSION CHECK (Explicit RBAC & Tenant Isolation)
    IF v_user_role = 'cidadao' THEN
        -- Citizens: Can ONLY cancel THEIR OWN requests
        DECLARE 
            v_owner_id UUID;
        BEGIN
            SELECT cidadao_id INTO v_owner_id FROM solicitacoes WHERE id = p_solicitacao_id;
            
            IF v_owner_id != v_user_id THEN
                RAISE EXCEPTION 'Acesso negado: Você não é o autor desta solicitação.';
            END IF;

            IF p_novo_status != 'cancelado' THEN
                RAISE EXCEPTION 'Acesso negado: Cidadãos só podem cancelar solicitações.';
            END IF;
        END;

    ELSIF v_user_role NOT IN ('admin', 'secretario', 'master_admin') THEN
        RAISE EXCEPTION 'Acesso negado: Perfil não autorizado.';
    END IF;

    -- Admin/Secretario Permissions
    IF v_user_role IN ('admin', 'secretario') THEN
        -- Must match City
        IF v_user_cidade_id != v_solicitacao_cidade_id THEN
            RAISE EXCEPTION 'Acesso negado: Este recurso pertence a outra cidade.';
        END IF;

        IF v_user_role = 'secretario' THEN
             -- Must match Secretaria
            IF v_solicitacao_secretaria_id IS NULL OR v_user_secretaria_id != v_solicitacao_secretaria_id THEN
                 RAISE EXCEPTION 'Acesso negado: Esta solicitação não está atribuída à sua secretaria.';
            END IF;
        END IF;
    END IF;

    -- 4. Status Validation
    IF p_novo_status = v_current_status THEN
        RAISE EXCEPTION 'O novo status deve ser diferente do atual.';
    END IF;

    -- 5. ATOMIC UPDATE
    UPDATE solicitacoes
    SET 
        status = p_novo_status,
        updated_at = NOW(),
        data_resolucao = CASE WHEN p_novo_status = 'resolvido' THEN NOW() ELSE data_resolucao END,
        comentario_resolucao = CASE WHEN p_novo_status = 'resolvido' THEN p_comentario_resolucao ELSE comentario_resolucao END,
        fotos_resolucao = CASE WHEN p_novo_status = 'resolvido' THEN p_fotos_resolucao ELSE fotos_resolucao END
    WHERE id = p_solicitacao_id;

    -- 6. [INTEGRATION] Feed Automático (Status Concluído)
    IF p_novo_status = 'resolvido' THEN
        INSERT INTO feed_posts (
            cidade_id,
            tipo,
            status,
            titulo,
            resumo,
            imagem_capa,
            published_at,
            created_by
        ) VALUES (
            v_solicitacao_cidade_id,
            'service_update',
            'published',
            'Solicitação Resolvida',
            'A solicitação #' || p_solicitacao_id || ' (' || v_current_status || ' -> ' || p_novo_status || ') foi concluída com sucesso.',
            (p_fotos_resolucao)[1], -- Tenta pegar a primeira foto se houver
            NOW(),
            v_user_id
        );
    END IF;

    -- 6. Insert History (Audit Trail)
    INSERT INTO historico_status (
        solicitacao_id,
        usuario_id,
        acao,
        comentario,
        created_at
    ) VALUES (
        p_solicitacao_id,
        v_user_id,
        CASE 
            WHEN p_novo_status = 'em_andamento' THEN 'Solicitação Em Andamento'
            WHEN p_novo_status = 'resolvido' THEN 'Solicitação Concluída'
            WHEN p_novo_status = 'aberto' THEN 'Solicitação Reaberta'
            WHEN p_novo_status = 'cancelado' THEN 'Solicitação Cancelada'
            ELSE 'Status alterado para ' || p_novo_status
        END,
        p_observacao_historico,
        NOW()
    );

    -- 7. Insert Additional Comment (Optional)
    IF p_comentario_adicional IS NOT NULL AND length(trim(p_comentario_adicional)) > 0 THEN
        INSERT INTO comentarios (
            solicitacao_id,
            autor_id,
            texto,
            interno,
            autor_tipo,
            created_at
        ) VALUES (
            p_solicitacao_id,
            v_user_id,
            p_comentario_adicional,
            p_interno,
            v_user_role,
            NOW()
        );
    END IF;

    -- 8. Return Success
    RETURN jsonb_build_object(
        'success', true,
        'new_status', p_novo_status,
        'timestamp', NOW()
    );
END;
$$;


ALTER FUNCTION "public"."rpc_atualizar_status_solicitacao"("p_solicitacao_id" "uuid", "p_novo_status" "text", "p_observacao_historico" "text", "p_comentario_resolucao" "text", "p_fotos_resolucao" "text"[], "p_comentario_adicional" "text", "p_interno" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_micro_task_finished_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- GUARD: Only act on tasks with SLA (deadline_at IS NOT NULL)
    IF NEW.deadline_at IS NULL THEN
        RETURN NEW;
    END IF;

    -- Set finished_at when status changes to 'concluida' for the first time
    IF NEW.status = 'concluida' 
       AND (OLD.status IS NULL OR OLD.status != 'concluida')
       AND NEW.finished_at IS NULL THEN
        NEW.finished_at := NOW();
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_micro_task_finished_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_micro_task_started_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- GUARD: Only act on tasks with SLA (deadline_at IS NOT NULL)
    IF NEW.deadline_at IS NULL THEN
        RETURN NEW;
    END IF;

    -- Set started_at when status changes to 'em_execucao' for the first time
    IF NEW.status = 'em_execucao' 
       AND (OLD.status IS NULL OR OLD.status != 'em_execucao')
       AND NEW.started_at IS NULL THEN
        NEW.started_at := NOW();
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_micro_task_started_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_requested_by_if_null"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN IF NEW.requested_by IS NULL THEN NEW.requested_by := auth.uid(); END IF; RETURN NEW; END; $$;


ALTER FUNCTION "public"."set_requested_by_if_null"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tarefas_concluida_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.status = 'concluida' AND (OLD.status IS NULL OR OLD.status != 'concluida') THEN
        NEW.concluida_at = now();
    ELSIF NEW.status != 'concluida' AND OLD.status = 'concluida' THEN
        NEW.concluida_at = NULL;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_tarefas_concluida_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_notify_macro_completion"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        PERFORM notify_admins_and_managers(
            'Tarefa Concluída',
            'A tarefa macro "' || NEW.titulo || '" foi concluída.',
            '/admin/tasks', -- Link to admin tasks
            'macro_task_completed',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_notify_macro_completion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_notify_micro_completion_admin"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    task_title TEXT;
    professional_name TEXT;
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        -- Get Task Title
        SELECT titulo INTO task_title FROM tarefas WHERE id = NEW.tarefa_id;
        -- Get Professional Name
        SELECT nome INTO professional_name FROM profissionais WHERE id = NEW.profissional_id;

        PERFORM notify_admins_and_managers(
            'Etapa Concluída',
            'A etapa "' || NEW.funcao || '" foi concluída por ' || professional_name || ' na tarefa "' || task_title || '".',
            '/admin/tasks',
            'micro_task_completed',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_notify_micro_completion_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_notify_micro_devolution_admin"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    task_title TEXT;
    reason TEXT;
BEGIN
    IF NEW.status = 'devolvida' AND (OLD IS NULL OR OLD.status != 'devolvida') THEN
        -- Get Task Title
        SELECT titulo INTO task_title FROM tarefas WHERE id = NEW.tarefa_id;
        
        -- Get Reason from logs (most recent returned log for this micro_task)
        SELECT motivo INTO reason 
        FROM tarefas_micro_logs 
        WHERE tarefa_micro_id = NEW.id 
        AND acao = 'returned' 
        ORDER BY created_at DESC 
        LIMIT 1;

        PERFORM notify_admins_and_managers(
            'Etapa Devolvida',
            'A etapa "' || NEW.funcao || '" foi devolvida na tarefa "' || task_title || '". Motivo: ' || COALESCE(reason, 'Não informado'),
            '/admin/tasks',
            'micro_task_returned',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_notify_micro_devolution_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_send_push_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  url TEXT := 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/send-push-notification';
  payload JSONB;
  request_id BIGINT;
BEGIN
  -- Payload matches what Edge Function expects (notificationId)
  payload := jsonb_build_object('notificationId', NEW.id);
  
  -- Call Edge Function asynchronously WITHOUT Authorization header
  -- The Edge Function itself runs with service_role context and handles auth internally
  SELECT net.http_post(
    url := url,
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    )
  ) INTO request_id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_send_push_notification"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trigger_send_push_notification"() IS 'Triggers asynchronous push notification via Edge Function. 
SECURITY FIX 2026-01-20: Removed hardcoded ANON KEY. 
Edge Function handles authentication internally with service_role context.';



CREATE OR REPLACE FUNCTION "public"."update_dependent_tasks"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- If a micro task is completed, unblock dependent tasks
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        UPDATE tarefas_micro
        SET status = 'pendente',
            updated_at = NOW()
        WHERE depends_on = NEW.id
        AND status = 'bloqueada';
        
        -- Log unblock action
        INSERT INTO tarefas_micro_logs (tarefa_micro_id, acao, from_profissional_id)
        SELECT id, 'unblocked', NEW.profissional_id
        FROM tarefas_micro
        WHERE depends_on = NEW.id
        AND status = 'pendente';
    END IF;
    
    -- If a completed micro task is reopened, block dependent tasks
    IF OLD IS NOT NULL AND OLD.status = 'concluida' AND NEW.status != 'concluida' THEN
        UPDATE tarefas_micro
        SET status = 'bloqueada',
            updated_at = NOW()
        WHERE depends_on = NEW.id
        AND status IN ('pendente', 'em_execucao');
        
        -- Log block action
        INSERT INTO tarefas_micro_logs (tarefa_micro_id, acao, from_profissional_id)
        SELECT id, 'blocked', NEW.profissional_id
        FROM tarefas_micro
        WHERE depends_on = NEW.id
        AND status = 'bloqueada';
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_dependent_tasks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_empresa_funcoes_permitidas_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_empresa_funcoes_permitidas_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_empresa_profissionais_permitidos_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_empresa_profissionais_permitidos_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_macro_task_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    total_weight INTEGER;
    completed_weight INTEGER;
    new_progress INTEGER;
    macro_task_id UUID;
BEGIN
    -- Get the macro task ID
    macro_task_id := COALESCE(NEW.tarefa_id, OLD.tarefa_id);
    
    -- Calculate total and completed weights
    SELECT 
        COALESCE(SUM(peso), 0),
        COALESCE(SUM(CASE WHEN status = 'concluida' THEN peso ELSE 0 END), 0)
    INTO total_weight, completed_weight
    FROM tarefas_micro
    WHERE tarefa_id = macro_task_id;
    
    -- Calculate progress percentage
    IF total_weight > 0 THEN
        new_progress := (completed_weight * 100) / total_weight;
    ELSE
        new_progress := 0;
    END IF;
    
    -- Update macro task
    UPDATE tarefas 
    SET progress = new_progress,
        updated_at = NOW()
    WHERE id = macro_task_id;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."update_macro_task_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_os"("p_os_id" "uuid", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_tarefa RECORD;
    v_micro_task JSONB;
    v_attachment_id UUID;
    v_new_micro_count INT := 0;
    v_current_micro_count INT;
    v_is_authorized BOOLEAN;
BEGIN
    -- 1. Fetch OS
    SELECT * INTO v_tarefa FROM tarefas WHERE id = p_os_id;

    IF v_tarefa.id IS NULL THEN
        RAISE EXCEPTION 'OS not found';
    END IF;

    -- 2. Verify Permissions (Creator OR Tenant Admin)
    -- STRICTLY BLOCK CROSS-TENANT: Admin must be in the specific company
    -- STRICTLY BLOCK SUPER ADMIN: Operational flows are for tenant users only
    v_is_authorized := (
        (v_tarefa.created_by = auth.uid()) 
        OR 
        (is_admin() AND is_admin_in_empresa(v_tarefa.empresa_id))
    );

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Permission denied: Only the creator or a company admin can edit this OS';
    END IF;

    IF v_tarefa.status IN ('identificando', 'cancelada') THEN -- Safety check on status
        RAISE EXCEPTION 'Cannot edit OS in current status';
    END IF;

    -- 3. Update Basic Fields
    -- Only update if provided in payload and non-null
    UPDATE tarefas
    SET 
        titulo = COALESCE(p_payload->>'titulo', titulo),
        descricao = COALESCE(p_payload->>'descricao', descricao),
        deadline = COALESCE((p_payload->>'deadline')::TIMESTAMPTZ, deadline),
        drive_link = COALESCE(p_payload->>'drive_link', drive_link),
        updated_at = NOW()
    WHERE id = p_os_id;

    -- 4. Handle Micro Tasks (Workflow Only)
    
    -- Count existing micro tasks
    SELECT COUNT(*) INTO v_current_micro_count FROM tarefas_micro WHERE tarefa_id = p_os_id AND ativo = true;

    IF p_payload ? 'micro_tasks' THEN
        -- CRITICA: Se for OS Simples (0 micro tasks) e tentar adicionar -> BLOQUEAR
        IF v_current_micro_count = 0 AND jsonb_array_length(p_payload->'micro_tasks') > 0 THEN
             RAISE EXCEPTION 'Cannot add micro-tasks to a Simple OS (Staff flow).';
        END IF;

        -- Iterate and Insert
        FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'micro_tasks')
        LOOP
            IF (v_micro_task->>'id') IS NULL THEN
                INSERT INTO tarefas_micro (
                    tarefa_id,
                    profissional_id,
                    funcao,
                    peso,
                    status
                ) VALUES (
                    p_os_id,
                    (v_micro_task->>'profissional_id')::UUID,
                    v_micro_task->>'funcao',
                    COALESCE((v_micro_task->>'peso')::INT, 1),
                    'pendente'
                );
            END IF;
        END LOOP;
        
        -- Handling "add_micro_tasks" specifically
        IF p_payload ? 'add_micro_tasks' THEN
             IF v_current_micro_count = 0 THEN
                 RAISE EXCEPTION 'Cannot add micro-tasks to a Simple OS.';
             END IF;
             
             FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'add_micro_tasks')
             LOOP
                INSERT INTO tarefas_micro (
                    tarefa_id,
                    profissional_id,
                    funcao,
                    peso,
                    status
                ) VALUES (
                    p_os_id,
                    (v_micro_task->>'profissional_id')::UUID,
                    v_micro_task->>'funcao',
                    COALESCE((v_micro_task->>'peso')::INT, 1),
                    'pendente'
                );
             END LOOP;
        END IF;

        -- Handling "remove_micro_task_ids"
        IF p_payload ? 'remove_micro_task_ids' THEN
            FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'remove_micro_task_ids')
            LOOP
                -- Validate Status
                DECLARE
                    v_mt_status TEXT;
                    v_mt_id UUID := (v_micro_task::text)::UUID;
                BEGIN
                    SELECT status INTO v_mt_status FROM tarefas_micro WHERE id = v_mt_id AND tarefa_id = p_os_id;
                    
                    IF v_mt_status IN ('em_execucao', 'concluida') THEN
                        RAISE EXCEPTION 'Cannot remove micro-task % because it is %', v_mt_id, v_mt_status;
                    END IF;
                    
                    -- Soft Delete
                    UPDATE tarefas_micro SET ativo = false WHERE id = v_mt_id;
                END;
            END LOOP;
        END IF;

    END IF;

    -- 5. Handle Handle Attachments (Soft Delete only)
    IF p_payload ? 'remove_attachment_ids' THEN
        FOR v_attachment_id IN SELECT * FROM jsonb_array_elements_text(p_payload->'remove_attachment_ids')
        LOOP
            UPDATE task_attachments 
            SET removed_at = NOW(),
                removed_by = auth.uid()
            WHERE id = v_attachment_id AND tarefa_id = p_os_id;
        END LOOP;
    END IF;
    
    -- Log update
    INSERT INTO logs_tarefas (tarefa_id, usuario_id, acao, dados_novos)
    VALUES (p_os_id, auth.uid(), 'update_os', p_payload);

END;
$$;


ALTER FUNCTION "public"."update_os"("p_os_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_payload" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_tarefa RECORD;
    v_micro_task JSONB;
    v_attachment_id UUID;
    v_current_micro_count INT;
    v_can_update BOOLEAN;
BEGIN
    -- 1. Validate Permissions using Canonical Helper
    -- This relies on the implementation of 'can_update_os' which checks RBAC + Tenant + Creator rules
    -- If can_update_os is not found, we fallback to a safe exception, but the user confirmed it exists.
    
    -- We can call the function directly if it returns boolean
    v_can_update := can_update_os(p_os_id);

    IF NOT v_can_update THEN
        RAISE EXCEPTION 'Permission denied: detection logic rejected update request.';
    END IF;

    -- 2. Fetch OS (Double check existence, though can_update_os likely checked it)
    SELECT * INTO v_tarefa FROM tarefas WHERE id = p_os_id;

    IF v_tarefa.id IS NULL THEN
        RAISE EXCEPTION 'OS not found';
    END IF;

    IF v_tarefa.status IN ('identificando', 'cancelada') THEN -- Safety check on status
        RAISE EXCEPTION 'Cannot edit OS in current status';
    END IF;

    -- 3. Update Basic Fields
    -- Only update if provided in payload and non-null
    UPDATE tarefas
    SET 
        titulo = COALESCE(p_payload->>'titulo', titulo),
        descricao = COALESCE(p_payload->>'descricao', descricao),
        deadline = COALESCE((p_payload->>'deadline')::TIMESTAMPTZ, deadline),
        drive_link = COALESCE(p_payload->>'drive_link', drive_link),
        updated_at = NOW()
    WHERE id = p_os_id;

    -- 4. Handle Micro Tasks (Workflow Only)
    
    -- Count existing active micro tasks
    SELECT COUNT(*) INTO v_current_micro_count FROM tarefas_micro WHERE tarefa_id = p_os_id AND ativo = true;

    IF p_payload ? 'micro_tasks' THEN
        -- CRITICA: Se for OS Simples (0 micro tasks) e tentar adicionar -> BLOQUEAR
        IF v_current_micro_count = 0 AND jsonb_array_length(p_payload->'micro_tasks') > 0 THEN
             RAISE EXCEPTION 'Cannot add micro-tasks to a Simple OS (Staff flow).';
        END IF;

        -- Iterate and Insert implicit "New" ones if structure matches (Compatibility)
        FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'micro_tasks')
        LOOP
            IF (v_micro_task->>'id') IS NULL THEN
                INSERT INTO tarefas_micro (
                    tarefa_id,
                    profissional_id,
                    funcao,
                    peso,
                    status
                ) VALUES (
                    p_os_id,
                    (v_micro_task->>'profissional_id')::UUID,
                    v_micro_task->>'funcao',
                    COALESCE((v_micro_task->>'peso')::INT, 1),
                    'pendente'
                );
            END IF;
        END LOOP;
        
        -- Handling "add_micro_tasks" specifically (Preferred)
        IF p_payload ? 'add_micro_tasks' THEN
             IF v_current_micro_count = 0 THEN
                 RAISE EXCEPTION 'Cannot add micro-tasks to a Simple OS.';
             END IF;
             
             FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'add_micro_tasks')
             LOOP
                INSERT INTO tarefas_micro (
                    tarefa_id,
                    profissional_id,
                    funcao,
                    peso,
                    status
                ) VALUES (
                    p_os_id,
                    (v_micro_task->>'profissional_id')::UUID,
                    v_micro_task->>'funcao',
                    COALESCE((v_micro_task->>'peso')::INT, 1),
                    'pendente'
                );
             END LOOP;
        END IF;

        -- Handling "remove_micro_task_ids"
        IF p_payload ? 'remove_micro_task_ids' THEN
            FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'remove_micro_task_ids')
            LOOP
                -- Validate Status
                DECLARE
                    v_mt_status TEXT;
                    v_mt_id UUID := (v_micro_task::text)::UUID;
                BEGIN
                    SELECT status INTO v_mt_status FROM tarefas_micro WHERE id = v_mt_id AND tarefa_id = p_os_id;
                    
                    IF v_mt_status IN ('em_execucao', 'concluida') THEN
                        RAISE EXCEPTION 'Cannot remove micro-task % because it is %', v_mt_id, v_mt_status;
                    END IF;
                    
                    -- Soft Delete
                    UPDATE tarefas_micro SET ativo = false WHERE id = v_mt_id;
                END;
            END LOOP;
        END IF;

    END IF;

    -- 5. Handle Handle Attachments (Soft Delete only)
    IF p_payload ? 'remove_attachment_ids' THEN
        FOR v_attachment_id IN SELECT * FROM jsonb_array_elements_text(p_payload->'remove_attachment_ids')
        LOOP
            UPDATE task_attachments 
            SET removed_at = NOW(),
            removed_by = auth.uid()
            WHERE id = v_attachment_id AND tarefa_id = p_os_id;
        END LOOP;
    END IF;
    
    -- Log update
    INSERT INTO logs_tarefas (tarefa_id, usuario_id, acao, dados_novos)
    VALUES (p_os_id, auth.uid(), 'update_os_v2', p_payload);

END;
$$;


ALTER FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline" timestamp with time zone, "p_prioridade" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF NOT public.can_update_os(p_os_id) THEN
        RAISE EXCEPTION 'Permissão negada para editar esta OS.';
    END IF;

    UPDATE tarefas
    SET
        titulo = p_titulo,
        descricao = p_descricao,
        deadline = p_deadline,
        prioridade = p_prioridade
    WHERE id = p_os_id;
END;
$$;


ALTER FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline" timestamp with time zone, "p_prioridade" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_tarefa_status_from_itens"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    total_itens INTEGER;
    concluidas_itens INTEGER;
    target_tarefa_id UUID;
BEGIN
    -- Determine which task to update
    target_tarefa_id := COALESCE(NEW.tarefa_id, OLD.tarefa_id);
    
    -- Count total and completed micro-tasks for this macro task
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'concluida')
    INTO total_itens, concluidas_itens
    FROM tarefas_itens
    WHERE tarefa_id = target_tarefa_id;
    
    -- If no micro-tasks exist, don't change macro task status
    IF total_itens = 0 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Update macro task status based on micro-task completion
    IF concluidas_itens = total_itens THEN
        -- All micro-tasks completed → macro task completed
        UPDATE tarefas
        SET status = 'concluida',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status != 'concluida';
        
    ELSIF concluidas_itens > 0 AND concluidas_itens < total_itens THEN
        -- Some completed → in progress
        UPDATE tarefas
        SET status = 'em_progresso',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('em_progresso', 'concluida');
        
    ELSE
        -- None completed → pending
        UPDATE tarefas
        SET status = 'pendente',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('pendente', 'em_progresso');
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."update_tarefa_status_from_itens"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_tarefa_status_from_itens"() IS 'Auto-updates macro task status based on micro-tasks completion (Portuguese status values)';



CREATE OR REPLACE FUNCTION "public"."update_tarefas_micro_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_tarefas_micro_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_profissional_empresa"() RETURNS "trigger"
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_empresa_id UUID;
  v_vinculo_existe BOOLEAN;
BEGIN
  -- Ignorar se tarefa não tem empresa (NULL é válido)
  SELECT empresa_id INTO v_empresa_id
  FROM tarefas
  WHERE id = NEW.tarefa_id;

  IF v_empresa_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Verificar vínculo ativo
  SELECT EXISTS (
    SELECT 1
    FROM empresa_profissionais
    WHERE profissional_id = NEW.profissional_id
    AND empresa_id = v_empresa_id
    AND ativo = true
  ) INTO v_vinculo_existe;

  -- Rejeitar se não houver vínculo
  IF NOT v_vinculo_existe THEN
    RAISE EXCEPTION 'Profissional não está vinculado à empresa';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_profissional_empresa"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_participant_empresa"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Check if participant's empresa matches meeting's empresa
    IF NOT EXISTS (
        SELECT 1
        FROM reunioes r
        INNER JOIN empresa_profissionais ep 
            ON ep.empresa_id = r.empresa_id 
            AND ep.profissional_id = NEW.profissional_id
            AND ep.ativo = TRUE
        WHERE r.id = NEW.reuniao_id
    ) THEN
        RAISE EXCEPTION 'Participante não pertence à empresa da reunião (cross-tenant violation)';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_participant_empresa"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validate_participant_empresa"() IS 'Validates that meeting participants belong to the same company as the meeting. Prevents cross-tenant data leaks.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "ap"."candidate_news" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'raw'::"text" NOT NULL,
    "titulo" "text" NOT NULL,
    "conteudo" "text",
    "url_original" "text" NOT NULL,
    "imagem_url" "text",
    "imagem_storage" "text",
    "published_at" timestamp with time zone,
    "fonte_id" "uuid",
    "categoria" "text",
    "posicao_feed" integer,
    "headline" "text",
    "caption" "text",
    "roteiro_json" "jsonb",
    "visual_energy_level" "text",
    "has_face" boolean DEFAULT false,
    "patrocinador_id" "uuid",
    "render_url" "text",
    "horario_agendado" timestamp with time zone,
    "instagram_post_id" "text",
    "processing_started_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "candidate_news_categoria_check" CHECK (("categoria" = ANY (ARRAY['regional'::"text", 'nacional_relevante'::"text", 'engajamento_alto'::"text", 'global_contextual'::"text"]))),
    CONSTRAINT "candidate_news_status_check" CHECK (("status" = ANY (ARRAY['raw'::"text", 'ready_for_scoring'::"text", 'scored'::"text", 'selected'::"text", 'pending_render'::"text", 'pending_review'::"text", 'approved'::"text", 'queued_for_posting'::"text", 'posted'::"text", 'rejected'::"text"]))),
    CONSTRAINT "candidate_news_visual_energy_level_check" CHECK (("visual_energy_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);


ALTER TABLE "ap"."candidate_news" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."candidate_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "news_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "base_score" double precision DEFAULT 0,
    "semantic_score" double precision DEFAULT 0,
    "learning_score" double precision DEFAULT 0,
    "score_total" double precision GENERATED ALWAYS AS ((("base_score" + "semantic_score") + "learning_score")) STORED,
    "scored_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "ap"."candidate_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."editorial_humanization" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "formality_level" integer DEFAULT 50 NOT NULL,
    "creativity_level" integer DEFAULT 50 NOT NULL,
    "technical_level" integer DEFAULT 30 NOT NULL,
    "anti_ai_variation" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "editorial_humanization_creativity_level_check" CHECK ((("creativity_level" >= 0) AND ("creativity_level" <= 100))),
    CONSTRAINT "editorial_humanization_formality_level_check" CHECK ((("formality_level" >= 0) AND ("formality_level" <= 100))),
    CONSTRAINT "editorial_humanization_technical_level_check" CHECK ((("technical_level" >= 0) AND ("technical_level" <= 100)))
);


ALTER TABLE "ap"."editorial_humanization" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."editorial_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "monthly_token_limit" integer DEFAULT 500000 NOT NULL,
    "monthly_token_used" integer DEFAULT 0 NOT NULL,
    "last_reset_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "ap"."editorial_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."editorial_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "input_tokens" integer,
    "output_tokens" integer,
    "cost_estimate" numeric(10,6),
    "model" "text",
    "prompt_snapshot" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "ap"."editorial_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."editorial_prompt_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "prompt_base" "text" NOT NULL,
    "created_by" "uuid",
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "ap"."editorial_prompt_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."editorial_rag_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "source_document_id" "uuid",
    "chunk_index" integer DEFAULT 0 NOT NULL,
    "content" "text" NOT NULL,
    "embedding" "public"."vector"(1536),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "ap"."editorial_rag_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."editorial_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "rule_type" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "editorial_rules_rule_type_check" CHECK (("rule_type" = ANY (ARRAY['forbidden'::"text", 'mandatory'::"text", 'substitution'::"text"])))
);


ALTER TABLE "ap"."editorial_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."editorial_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "vault_secret_id" "uuid",
    "model_primary" "text" DEFAULT 'gpt-4o-mini'::"text" NOT NULL,
    "model_fallback" "text" DEFAULT 'gpt-4o'::"text" NOT NULL,
    "temperature" numeric(3,2) DEFAULT 0.7 NOT NULL,
    "top_p" numeric(3,2) DEFAULT 1.0 NOT NULL,
    "max_tokens" integer DEFAULT 400 NOT NULL,
    "system_prompt_override" boolean DEFAULT false NOT NULL,
    "override_prompt_text" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "ap"."editorial_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."learning_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "news_id" "uuid",
    "categoria" "text",
    "fonte_id" "uuid",
    "acao" "text",
    "score_delta" double precision DEFAULT 0,
    "registrado_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "learning_history_acao_check" CHECK (("acao" = ANY (ARRAY['approved'::"text", 'rejected'::"text", 'edited'::"text"])))
);


ALTER TABLE "ap"."learning_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."patrocinadores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "template_id" "text",
    "logo_url" "text",
    "ativo" boolean DEFAULT true,
    "ultimo_uso_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "ap"."patrocinadores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "ap"."sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "tipo" "text" DEFAULT 'rss'::"text" NOT NULL,
    "url" "text" NOT NULL,
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sources_tipo_check" CHECK (("tipo" = ANY (ARRAY['rss'::"text", 'google_news_rss'::"text"])))
);


ALTER TABLE "ap"."sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anexos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "solicitacao_id" "uuid",
    "usuario_id" "uuid",
    "url" "text" NOT NULL,
    "tipo" "text",
    "nome" "text",
    "tamanho" bigint,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."anexos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."areas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."areas" OWNER TO "postgres";


COMMENT ON TABLE "public"."areas" IS 'Áreas/setores da organização';



COMMENT ON COLUMN "public"."areas"."id" IS 'Identificador único da área';



COMMENT ON COLUMN "public"."areas"."nome" IS 'Nome da área (ex: Marketing, TI, RH)';



COMMENT ON COLUMN "public"."areas"."ativo" IS 'Se a área está ativa';



COMMENT ON COLUMN "public"."areas"."created_at" IS 'Data de criação da área';



CREATE TABLE IF NOT EXISTS "public"."arquivos_tarefas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tarefa_id" "uuid",
    "research_drive_link" "text",
    "final_drive_link" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."arquivos_tarefas" OWNER TO "postgres";


COMMENT ON TABLE "public"."arquivos_tarefas" IS 'Links do Google Drive relacionados às tarefas';



CREATE TABLE IF NOT EXISTS "public"."cidades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "dominio" "text",
    "slug" "text",
    "ativo" boolean DEFAULT true,
    "configuracoes" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cidades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cliente_profissionais" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "funcao" "text" NOT NULL,
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."cliente_profissionais" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cnpj" "text",
    "ativo" boolean DEFAULT true,
    "drive_link" "text",
    "empresa_id" "uuid"
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


COMMENT ON TABLE "public"."clientes" IS 'Clientes da agência TVG';



COMMENT ON COLUMN "public"."clientes"."drive_link" IS 'Google Drive folder URL for company files. Optional field used in Content tab. Inherited by tasks without specific drive_link.';



CREATE TABLE IF NOT EXISTS "public"."comentarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "solicitacao_id" "uuid",
    "autor_id" "uuid",
    "texto" "text" NOT NULL,
    "interno" boolean DEFAULT false,
    "autor_tipo" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."comentarios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departamentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "cor_hex" "text" DEFAULT '#6366f1'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."departamentos" OWNER TO "postgres";


COMMENT ON TABLE "public"."departamentos" IS 'Departamentos da agência (ex: Design, Conteúdo, Social Media)';



CREATE TABLE IF NOT EXISTS "public"."empresa_profissionais" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "funcao" "text" NOT NULL,
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."empresa_profissionais" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."empresa_profissionais_backup_2026_01_12" (
    "id" "uuid",
    "empresa_id" "uuid",
    "profissional_id" "uuid",
    "funcao" "text",
    "ativo" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."empresa_profissionais_backup_2026_01_12" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."empresas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status_conta" "text" DEFAULT 'active'::"text",
    "icp_status" "text" DEFAULT 'doubtful'::"text",
    "internal_notes" "text",
    "tipo_negocio" "text",
    "last_activity_at" timestamp with time zone DEFAULT "now"(),
    "cnpj" "text",
    "tenant_id" "uuid",
    "empresa_tipo" "text" DEFAULT 'operacional'::"text" NOT NULL,
    "drive_link" "text",
    "ativo" boolean DEFAULT true,
    "slug" character varying(255) NOT NULL,
    "logo_url" "text",
    CONSTRAINT "check_tenant_rules" CHECK (((("empresa_tipo" = 'tenant'::"text") AND ("tenant_id" IS NULL)) OR ("empresa_tipo" = 'operacional'::"text"))),
    CONSTRAINT "empresas_empresa_tipo_check" CHECK (("empresa_tipo" = ANY (ARRAY['tenant'::"text", 'operacional'::"text"]))),
    CONSTRAINT "empresas_icp_status_check" CHECK (("icp_status" = ANY (ARRAY['correct'::"text", 'doubtful'::"text", 'wrong'::"text"]))),
    CONSTRAINT "empresas_status_conta_check" CHECK (("status_conta" = ANY (ARRAY['trial'::"text", 'active'::"text", 'suspended'::"text"]))),
    CONSTRAINT "empresas_tipo_negocio_check" CHECK (("tipo_negocio" = ANY (ARRAY['agency'::"text", 'studio'::"text", 'producer'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."empresas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feed_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cidade_id" "uuid" NOT NULL,
    "tipo" "public"."feed_post_type" NOT NULL,
    "status" "public"."feed_post_status" DEFAULT 'draft'::"public"."feed_post_status" NOT NULL,
    "titulo" character varying(140) NOT NULL,
    "resumo" character varying(280) NOT NULL,
    "corpo" "text",
    "imagem_capa" "text",
    "link_externo" "text",
    "link_texto" character varying(30),
    "published_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "check_dates" CHECK (("expires_at" > "published_at")),
    CONSTRAINT "check_link_label" CHECK ((("link_texto" IS NULL) OR ("link_externo" IS NOT NULL)))
);


ALTER TABLE "public"."feed_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."historico_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "solicitacao_id" "uuid",
    "usuario_id" "uuid",
    "acao" "text",
    "comentario" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."historico_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."logs_tarefas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tarefa_id" "uuid",
    "usuario_id" "uuid",
    "acao" "text" NOT NULL,
    "dados_anteriores" "jsonb",
    "dados_novos" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."logs_tarefas" OWNER TO "postgres";


COMMENT ON TABLE "public"."logs_tarefas" IS 'Histórico de alterações nas tarefas (auditoria)';



CREATE TABLE IF NOT EXISTS "public"."notificacoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "os_id" "uuid",
    "evento_id" "uuid",
    "tipo" character varying(50) NOT NULL,
    "titulo" "text" NOT NULL,
    "mensagem" "text",
    "lida" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "tem_referencia" CHECK ((("os_id" IS NOT NULL) OR ("evento_id" IS NOT NULL) OR (("metadata" ->> 'reuniao_id'::"text") IS NOT NULL)))
);


ALTER TABLE "public"."notificacoes" OWNER TO "postgres";


COMMENT ON TABLE "public"."notificacoes" IS 'Notificações in-app para profissionais sobre eventos em OSs';



COMMENT ON COLUMN "public"."notificacoes"."profissional_id" IS 'Destinatário da notificação';



COMMENT ON COLUMN "public"."notificacoes"."os_id" IS 'OS relacionada (opcional)';



COMMENT ON COLUMN "public"."notificacoes"."evento_id" IS 'Evento que gerou a notificação (opcional)';



COMMENT ON COLUMN "public"."notificacoes"."tipo" IS 'Tipo da notificação (corresponde a os_evento_tipo)';



COMMENT ON COLUMN "public"."notificacoes"."titulo" IS 'Título curto da notificação';



COMMENT ON COLUMN "public"."notificacoes"."mensagem" IS 'Texto completo da notificação';



COMMENT ON COLUMN "public"."notificacoes"."lida" IS 'Se notificação foi visualizada';



COMMENT ON COLUMN "public"."notificacoes"."metadata" IS 'Additional structured data for notification (e.g., meeting details, intervals)';



COMMENT ON CONSTRAINT "tem_referencia" ON "public"."notificacoes" IS 'Ensures notification is linked to an OS (os_id), event (evento_id), or meeting (metadata.reuniao_id).';



CREATE TABLE IF NOT EXISTS "public"."notification_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text",
    "retry_count" integer DEFAULT 0,
    "tenant_id" "uuid",
    "priority" integer DEFAULT 0,
    CONSTRAINT "notification_queue_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['task'::"text", 'micro_task'::"text"]))),
    CONSTRAINT "notification_queue_event_type_check" CHECK (("event_type" = ANY (ARRAY['macro_completed'::"text", 'micro_completed'::"text", 'micro_returned'::"text", 'task_assigned'::"text", 'status_alterado'::"text", 'comentario_adicionado'::"text", 'profissional_atribuido'::"text"]))),
    CONSTRAINT "notification_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."notification_queue" OWNER TO "postgres";


COMMENT ON TABLE "public"."notification_queue" IS 'Async queue for notification processing via pg_cron. Prevents sync triggers from blocking transactions.';



COMMENT ON COLUMN "public"."notification_queue"."payload" IS 'JSONB payload with title, message, link, and optional profissional_ids array';



COMMENT ON COLUMN "public"."notification_queue"."retry_count" IS 'Number of processing retries (for future fault tolerance)';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone,
    "cleared_at" timestamp with time zone,
    "link" "text",
    "read" boolean DEFAULT false,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE ONLY "public"."notifications" REPLICA IDENTITY FULL;


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'Notifications table with Realtime enabled for instant updates';



CREATE TABLE IF NOT EXISTS "public"."tarefas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid",
    "titulo" "text" NOT NULL,
    "descricao" "text",
    "departamento_id" "uuid",
    "assigned_to" "uuid",
    "created_by" "uuid",
    "deadline" timestamp with time zone NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'pendente'::"text" NOT NULL,
    "em_atraso_desde" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "area_id" "uuid",
    "requested_by" "uuid",
    "drive_link" "text",
    "empresa_id" "uuid",
    "prioridade" "public"."prioridade_tarefa" DEFAULT 'normal'::"public"."prioridade_tarefa" NOT NULL,
    "concluida_at" timestamp with time zone,
    "progress" integer DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "has_micro_tasks" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deadline_at" timestamp with time zone,
    CONSTRAINT "tarefas_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "tarefas_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100))),
    CONSTRAINT "tarefas_status_check" CHECK (("status" = ANY (ARRAY['pendente'::"text", 'em_execucao'::"text", 'concluida'::"text", 'atrasada'::"text", 'cancelada'::"text"])))
);

ALTER TABLE ONLY "public"."tarefas" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tarefas" OWNER TO "postgres";


COMMENT ON TABLE "public"."tarefas" IS 'Tarefas/demandas do sistema';



COMMENT ON COLUMN "public"."tarefas"."area_id" IS 'Área executora';



COMMENT ON COLUMN "public"."tarefas"."requested_by" IS 'Solicitante da tarefa';



COMMENT ON COLUMN "public"."tarefas"."drive_link" IS 'Google Drive link for task files and resources';



COMMENT ON COLUMN "public"."tarefas"."prioridade" IS 'Prioridade da tarefa: baixa, normal, alta, urgente';



COMMENT ON COLUMN "public"."tarefas"."concluida_at" IS 'Timestamp when task was completed';



COMMENT ON COLUMN "public"."tarefas"."has_micro_tasks" IS 'ETAPA 4: Flag auxiliar. TRUE = OS complexa (workflow). Fonte da verdade: existência de registros em tarefas_micro. Calculado automaticamente na conversão';



COMMENT ON COLUMN "public"."tarefas"."deleted_at" IS 'ETAPA 4: Soft delete. NULL = ativa, NOT NULL = excluída. Evento os_excluida registra a exclusão';



CREATE OR REPLACE VIEW "public"."os_dashboard_summary" AS
 SELECT "id",
    "empresa_id",
    "titulo",
    "status",
    "priority",
    "deadline",
    "assigned_to",
    "created_at",
        CASE
            WHEN (("deadline" < "now"()) AND ("status" <> ALL (ARRAY['completed'::"text", 'concluida'::"text", 'concluído'::"text", 'done'::"text"]))) THEN true
            ELSE false
        END AS "is_overdue"
   FROM "public"."tarefas" "t";


ALTER VIEW "public"."os_dashboard_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."os_eventos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "os_id" "uuid" NOT NULL,
    "tipo" "public"."os_evento_tipo" NOT NULL,
    "autor_id" "uuid",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "metadata_valido" CHECK ((("metadata" IS NULL) OR ("jsonb_typeof"("metadata") = 'object'::"text")))
);


ALTER TABLE "public"."os_eventos" OWNER TO "postgres";


COMMENT ON TABLE "public"."os_eventos" IS 'Timeline de eventos da OS. Eventos são IMUTÁVEIS (sem UPDATE/DELETE policies).';



COMMENT ON COLUMN "public"."os_eventos"."os_id" IS 'Referência à OS (tarefa)';



COMMENT ON COLUMN "public"."os_eventos"."tipo" IS 'Tipo do evento (enum)';



COMMENT ON COLUMN "public"."os_eventos"."autor_id" IS 'Profissional que causou o evento. NULL = sistema/automático';



COMMENT ON COLUMN "public"."os_eventos"."metadata" IS 'Dados contextuais em JSON. Estrutura varia por tipo de evento';



COMMENT ON COLUMN "public"."os_eventos"."created_at" IS 'Timestamp de criação do evento (imutável)';



CREATE TABLE IF NOT EXISTS "public"."profissionais" (
    "id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "email" "text" NOT NULL,
    "departamento_id" "uuid",
    "role" "text" NOT NULL,
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "area_id" "uuid",
    "last_activity_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profissionais_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'profissional'::"text", 'super_admin'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."profissionais" OWNER TO "postgres";


COMMENT ON TABLE "public"."profissionais" IS 'Profissionais da agência (admins e profissionais)';



COMMENT ON COLUMN "public"."profissionais"."area_id" IS 'Área do profissional';



COMMENT ON COLUMN "public"."profissionais"."last_activity_at" IS 'Timestamp of last user activity (login, dashboard access, or significant action)';



CREATE TABLE IF NOT EXISTS "public"."task_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "editado" boolean DEFAULT false,
    CONSTRAINT "content_length_limit" CHECK ((("char_length"("content") > 0) AND ("char_length"("content") <= 5000))),
    CONSTRAINT "content_not_empty" CHECK ((TRIM(BOTH FROM "content") <> ''::"text"))
);


ALTER TABLE "public"."task_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_comments" IS 'Activity timeline and comments for tasks';



COMMENT ON COLUMN "public"."task_comments"."task_id" IS 'Reference to the task (macro task)';



COMMENT ON COLUMN "public"."task_comments"."author_id" IS 'Professional who wrote the comment';



COMMENT ON COLUMN "public"."task_comments"."content" IS 'Comment text';



COMMENT ON COLUMN "public"."task_comments"."updated_at" IS 'Última atualização do comentário (edição)';



COMMENT ON COLUMN "public"."task_comments"."deleted_at" IS 'Soft delete timestamp. NULL = ativo, NOT NULL = deletado';



COMMENT ON COLUMN "public"."task_comments"."editado" IS 'Indica se comentário foi editado após criação';



CREATE OR REPLACE VIEW "public"."os_timeline_view" WITH ("security_invoker"='true') AS
 SELECT 'comentario'::"text" AS "item_tipo",
    "c"."id",
    "c"."task_id" AS "os_id",
    "c"."content" AS "texto",
    NULL::"public"."os_evento_tipo" AS "evento_tipo",
    NULL::"jsonb" AS "metadata",
    "c"."author_id" AS "autor_id",
    "p"."nome" AS "autor_nome",
    "c"."editado",
    "c"."created_at",
    "c"."updated_at",
    ( SELECT "tarefas"."empresa_id"
           FROM "public"."tarefas"
          WHERE ("tarefas"."id" = "c"."task_id")) AS "empresa_id"
   FROM ("public"."task_comments" "c"
     LEFT JOIN "public"."profissionais" "p" ON (("p"."id" = "c"."author_id")))
  WHERE (("c"."deleted_at" IS NULL) AND "public"."is_os_participant"("c"."task_id"))
UNION ALL
 SELECT 'evento'::"text" AS "item_tipo",
    "e"."id",
    "e"."os_id",
    NULL::"text" AS "texto",
    "e"."tipo" AS "evento_tipo",
    "e"."metadata",
    "e"."autor_id",
    "p"."nome" AS "autor_nome",
    NULL::boolean AS "editado",
    "e"."created_at",
    NULL::timestamp with time zone AS "updated_at",
    ( SELECT "tarefas"."empresa_id"
           FROM "public"."tarefas"
          WHERE ("tarefas"."id" = "e"."os_id")) AS "empresa_id"
   FROM ("public"."os_eventos" "e"
     LEFT JOIN "public"."profissionais" "p" ON (("p"."id" = "e"."autor_id")))
  WHERE "public"."is_os_participant"("e"."os_id");


ALTER VIEW "public"."os_timeline_view" OWNER TO "postgres";


COMMENT ON VIEW "public"."os_timeline_view" IS 'ETAPA 3: Timeline unificada de comentários e eventos. Aplica RLS via is_os_participant() inline. security_invoker = true força verificação de permissões.';



CREATE TABLE IF NOT EXISTS "public"."overdue_notifications_log" (
    "tarefa_id" "uuid" NOT NULL,
    "last_notified_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."overdue_notifications_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."overdue_notifications_log" IS 'Tracks last notification time to prevent hourly spam';



CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "auth_key" "text" NOT NULL,
    "p256dh_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."push_subscriptions" IS 'Subscriptions de push notifications';



CREATE TABLE IF NOT EXISTS "public"."reunioes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "titulo" "text" NOT NULL,
    "descricao" "text",
    "data_inicio" timestamp with time zone NOT NULL,
    "data_fim" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "criada_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "timezone" "text" DEFAULT 'America/Sao_Paulo'::"text",
    CONSTRAINT "reunioes_status_check" CHECK (("status" = ANY (ARRAY['agendada'::"text", 'em_andamento'::"text", 'realizada'::"text", 'cancelada'::"text"]))),
    CONSTRAINT "reunioes_valid_time" CHECK (("data_fim" > "data_inicio"))
);


ALTER TABLE "public"."reunioes" OWNER TO "postgres";


COMMENT ON TABLE "public"."reunioes" IS 'In-person meetings - Admin creates, Staff participates';



COMMENT ON COLUMN "public"."reunioes"."empresa_id" IS 'Company that owns this meeting';



COMMENT ON COLUMN "public"."reunioes"."titulo" IS 'Meeting title';



COMMENT ON COLUMN "public"."reunioes"."descricao" IS 'Meeting description/agenda';



COMMENT ON COLUMN "public"."reunioes"."data_inicio" IS 'Meeting start time';



COMMENT ON COLUMN "public"."reunioes"."data_fim" IS 'Meeting end time';



COMMENT ON COLUMN "public"."reunioes"."status" IS 'scheduled | completed | cancelled';



COMMENT ON COLUMN "public"."reunioes"."criada_por" IS 'Admin who created the meeting';



COMMENT ON COLUMN "public"."reunioes"."timezone" IS 'Meeting timezone in IANA format (e.g., America/Sao_Paulo, America/Manaus). Optional field, default preserves current behavior for single-timezone companies.';



CREATE TABLE IF NOT EXISTS "public"."reunioes_participantes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reuniao_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "confirmado" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "participou" boolean DEFAULT false,
    "checked_at" timestamp with time zone
);


ALTER TABLE "public"."reunioes_participantes" OWNER TO "postgres";


COMMENT ON TABLE "public"."reunioes_participantes" IS 'Meeting participants - Many-to-many relationship';



COMMENT ON COLUMN "public"."reunioes_participantes"."confirmado" IS 'Whether participant confirmed attendance';



CREATE TABLE IF NOT EXISTS "public"."secretarias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cidade_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "nome_secretario" "text",
    "email" "text",
    "telefone" "text",
    "descricao" "text",
    "criado_em" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."secretarias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."solicitacoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cidadao_id" "uuid",
    "cidade_id" "uuid" NOT NULL,
    "tipo_solicitacao_id" "uuid",
    "tipo_ocorrencia" "text",
    "titulo" "text" NOT NULL,
    "descricao" "text",
    "endereco" "text",
    "latitude" double precision,
    "longitude" double precision,
    "foto_url" "text",
    "status" "text" DEFAULT 'aberto'::"text",
    "protocolo" "text",
    "idempotency_key" "text",
    "data_resolucao" timestamp with time zone,
    "comentario_resolucao" "text",
    "fotos_resolucao" "text"[],
    "secretaria_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "solicitacoes_tipo_ocorrencia_check" CHECK (("tipo_ocorrencia" = ANY (ARRAY['sugestao'::"text", 'reclamacao'::"text", 'elogio'::"text"])))
);


ALTER TABLE "public"."solicitacoes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tarefas_backup_20260112" (
    "id" "uuid",
    "cliente_id" "uuid",
    "titulo" "text",
    "descricao" "text",
    "departamento_id" "uuid",
    "assigned_to" "uuid",
    "created_by" "uuid",
    "deadline" timestamp with time zone,
    "priority" "text",
    "status" "text",
    "em_atraso_desde" timestamp with time zone,
    "created_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "area_id" "uuid",
    "requested_by" "uuid",
    "drive_link" "text",
    "empresa_id" "uuid",
    "prioridade" "public"."prioridade_tarefa",
    "concluida_at" timestamp with time zone,
    "progress" integer,
    "updated_at" timestamp with time zone,
    "has_micro_tasks" boolean,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."tarefas_backup_20260112" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."tarefas_com_status_real" AS
 SELECT "id",
    "cliente_id",
    "titulo",
    "descricao",
    "departamento_id",
    "assigned_to",
    "created_by",
    "deadline",
    "priority",
    "status",
    "em_atraso_desde",
    "created_at",
    "completed_at",
    "area_id",
    "requested_by",
    "drive_link",
    "empresa_id",
    "prioridade",
    (("now"() > "deadline") AND ("status" <> 'concluida'::"text")) AS "is_overdue",
        CASE
            WHEN (("now"() > "deadline") AND ("status" <> 'concluida'::"text")) THEN (EXTRACT(epoch FROM ("now"() - "deadline")) / (3600)::numeric)
            ELSE (0)::numeric
        END AS "hours_overdue"
   FROM "public"."tarefas" "t";


ALTER VIEW "public"."tarefas_com_status_real" OWNER TO "postgres";


COMMENT ON VIEW "public"."tarefas_com_status_real" IS 'Tasks with computed overdue status (derived, not persisted)';



CREATE TABLE IF NOT EXISTS "public"."tarefas_micro" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tarefa_id" "uuid" NOT NULL,
    "profissional_id" "uuid" NOT NULL,
    "funcao" "text" NOT NULL,
    "status" "text" DEFAULT 'pendente'::"text" NOT NULL,
    "peso" integer DEFAULT 1 NOT NULL,
    "depends_on" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "drive_link" "text",
    "deadline_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "ativo" boolean DEFAULT true,
    "ordem" integer,
    CONSTRAINT "chk_tarefas_micro_ordem_positive" CHECK ((("ordem" IS NULL) OR ("ordem" > 0))),
    CONSTRAINT "tarefas_micro_peso_check" CHECK (("peso" > 0)),
    CONSTRAINT "tarefas_micro_status_check" CHECK (("status" = ANY (ARRAY['pendente'::"text", 'bloqueada'::"text", 'em_execucao'::"text", 'concluida'::"text", 'devolvida'::"text"])))
);

ALTER TABLE ONLY "public"."tarefas_micro" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tarefas_micro" OWNER TO "postgres";


COMMENT ON TABLE "public"."tarefas_micro" IS 'Micro tasks table with Realtime enabled for activity feed';



COMMENT ON COLUMN "public"."tarefas_micro"."drive_link" IS 'Optional link to Google Drive or other file storage for this micro task';



COMMENT ON COLUMN "public"."tarefas_micro"."deadline_at" IS 'SLA deadline for this micro task. NULL = no SLA tracking';



COMMENT ON COLUMN "public"."tarefas_micro"."started_at" IS 'Timestamp when professional started working (status changed to em_execucao)';



COMMENT ON COLUMN "public"."tarefas_micro"."finished_at" IS 'Timestamp when micro task was completed (status changed to concluida)';



COMMENT ON COLUMN "public"."tarefas_micro"."ordem" IS 'Ordem sequencial da etapa no workflow (1, 2, 3...). NULL para tarefas antigas ou não-workflow.';



CREATE TABLE IF NOT EXISTS "public"."tarefas_micro_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tarefa_micro_id" "uuid" NOT NULL,
    "from_profissional_id" "uuid",
    "to_profissional_id" "uuid",
    "acao" "text" NOT NULL,
    "motivo" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tarefas_micro_logs_acao_check" CHECK (("acao" = ANY (ARRAY['created'::"text", 'started'::"text", 'completed'::"text", 'returned'::"text", 'blocked'::"text", 'unblocked'::"text"])))
);


ALTER TABLE "public"."tarefas_micro_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_attachments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tarefa_id" "uuid" NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "filename" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "mime_type" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "removed_at" timestamp with time zone,
    "removed_by" "uuid",
    CONSTRAINT "task_attachments_file_size_check" CHECK ((("file_size" > 0) AND ("file_size" <= 10485760))),
    CONSTRAINT "task_attachments_filename_not_empty" CHECK (("length"("filename") > 0)),
    CONSTRAINT "task_attachments_original_filename_not_empty" CHECK (("length"("original_filename") > 0))
);


ALTER TABLE "public"."task_attachments" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_attachments" IS 'Stores metadata for files attached to tasks';



COMMENT ON COLUMN "public"."task_attachments"."filename" IS 'UUID-based filename stored in Supabase Storage';



COMMENT ON COLUMN "public"."task_attachments"."original_filename" IS 'Original filename uploaded by user';



COMMENT ON COLUMN "public"."task_attachments"."file_size" IS 'File size in bytes (max 10MB)';



COMMENT ON COLUMN "public"."task_attachments"."storage_path" IS 'Full path in storage bucket: {empresa_id}/{tarefa_id}/{uuid}_{filename}';



CREATE TABLE IF NOT EXISTS "public"."task_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tipos_solicitacao" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cidade_id" "uuid" NOT NULL,
    "secretaria_id" "uuid",
    "nome" "text" NOT NULL,
    "descricao" "text",
    "prazo_dias" integer DEFAULT 15,
    "prioridade" "text" DEFAULT 'media'::"text",
    "ativo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tipos_solicitacao" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios" (
    "id" "uuid" NOT NULL,
    "cidade_id" "uuid",
    "secretaria_id" "uuid",
    "nome" "text",
    "email" "text",
    "tipo_perfil" "text" DEFAULT 'cidadao'::"text",
    "cpf" "text",
    "telefone" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."usuarios" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_feed_institucional_publico" WITH ("security_invoker"='true') AS
 SELECT "id",
    "cidade_id",
    "tipo",
    "titulo",
    "resumo",
    "imagem_capa" AS "imagem_url",
    "link_externo" AS "action_link",
    "link_texto" AS "action_label",
    "published_at" AS "data_publicacao",
    ("tipo" = 'emergency_alert'::"public"."feed_post_type") AS "is_alert",
    "status"
   FROM "public"."feed_posts"
  WHERE (("status" = 'published'::"public"."feed_post_status") AND ("deleted_at" IS NULL) AND ("published_at" <= "now"()) AND (("expires_at" > "now"()) OR ("expires_at" IS NULL)));


ALTER VIEW "public"."v_feed_institucional_publico" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_active_locks" AS
 SELECT "pg_stat_activity"."pid",
    "pg_stat_activity"."usename" AS "user",
    "pg_blocking_pids"("pg_stat_activity"."pid") AS "blocked_by",
    "pg_locks"."mode" AS "lock_mode",
    "pg_locks"."locktype",
    "pg_locks"."granted",
    "pg_stat_activity"."state",
    ("now"() - "pg_stat_activity"."query_start") AS "lock_duration",
    "substring"("pg_stat_activity"."query", 1, 100) AS "query_snippet"
   FROM ("pg_stat_activity"
     JOIN "pg_locks" USING ("pid"))
  WHERE (("pg_stat_activity"."pid" <> "pg_backend_pid"()) AND (("pg_stat_activity"."state" = 'active'::"text") OR ("pg_locks"."locktype" = 'advisory'::"text")) AND ("pg_locks"."database" = ( SELECT "pg_database"."oid"
           FROM "pg_database"
          WHERE ("pg_database"."datname" = "current_database"()))));


ALTER VIEW "public"."vw_active_locks" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_admin_tenant_compliance" AS
 SELECT "p"."id",
    "p"."email",
    "p"."role",
    "p"."ativo" AS "profissional_ativo",
    "count"("ep"."empresa_id") FILTER (WHERE (("e"."empresa_tipo" = 'tenant'::"text") AND ("ep"."ativo" = true) AND ("e"."ativo" = true))) AS "tenant_link_count",
        CASE
            WHEN (("p"."role" = 'admin'::"text") AND ("count"("ep"."empresa_id") FILTER (WHERE (("e"."empresa_tipo" = 'tenant'::"text") AND ("ep"."ativo" = true) AND ("e"."ativo" = true))) = 0)) THEN 'INVALID'::"text"
            WHEN (("p"."role" = 'admin'::"text") AND ("count"("ep"."empresa_id") FILTER (WHERE (("e"."empresa_tipo" = 'tenant'::"text") AND ("ep"."ativo" = true) AND ("e"."ativo" = true))) > 0)) THEN 'VALID'::"text"
            ELSE 'N/A'::"text"
        END AS "compliance_status"
   FROM (("public"."profissionais" "p"
     LEFT JOIN "public"."empresa_profissionais" "ep" ON (("ep"."profissional_id" = "p"."id")))
     LEFT JOIN "public"."empresas" "e" ON (("e"."id" = "ep"."empresa_id")))
  WHERE (("p"."role" = ANY (ARRAY['admin'::"text", 'super_admin'::"text", 'staff'::"text"])) AND ("p"."ativo" = true))
  GROUP BY "p"."id", "p"."email", "p"."role", "p"."ativo"
  ORDER BY
        CASE
            WHEN (("p"."role" = 'admin'::"text") AND ("count"("ep"."empresa_id") FILTER (WHERE (("e"."empresa_tipo" = 'tenant'::"text") AND ("ep"."ativo" = true) AND ("e"."ativo" = true))) = 0)) THEN 'INVALID'::"text"
            WHEN (("p"."role" = 'admin'::"text") AND ("count"("ep"."empresa_id") FILTER (WHERE (("e"."empresa_tipo" = 'tenant'::"text") AND ("ep"."ativo" = true) AND ("e"."ativo" = true))) > 0)) THEN 'VALID'::"text"
            ELSE 'N/A'::"text"
        END DESC, "p"."email";


ALTER VIEW "public"."vw_admin_tenant_compliance" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_blocked_queries" AS
 SELECT "blocked_locks"."pid" AS "blocked_pid",
    "blocked_activity"."usename" AS "blocked_user",
    "blocked_activity"."query" AS "blocked_query",
    "blocking_locks"."pid" AS "blocking_pid",
    "blocking_activity"."usename" AS "blocking_user",
    "blocking_activity"."query" AS "blocking_query",
    ("now"() - "blocked_activity"."query_start") AS "wait_duration"
   FROM ((("pg_locks" "blocked_locks"
     JOIN "pg_stat_activity" "blocked_activity" ON (("blocked_activity"."pid" = "blocked_locks"."pid")))
     JOIN "pg_locks" "blocking_locks" ON ((("blocking_locks"."locktype" = "blocked_locks"."locktype") AND (NOT ("blocking_locks"."database" IS DISTINCT FROM "blocked_locks"."database")) AND (NOT ("blocking_locks"."relation" IS DISTINCT FROM "blocked_locks"."relation")) AND (NOT ("blocking_locks"."page" IS DISTINCT FROM "blocked_locks"."page")) AND (NOT ("blocking_locks"."tuple" IS DISTINCT FROM "blocked_locks"."tuple")) AND (NOT ("blocking_locks"."virtualxid" IS DISTINCT FROM "blocked_locks"."virtualxid")) AND (NOT ("blocking_locks"."transactionid" IS DISTINCT FROM "blocked_locks"."transactionid")) AND (NOT ("blocking_locks"."classid" IS DISTINCT FROM "blocked_locks"."classid")) AND (NOT ("blocking_locks"."objid" IS DISTINCT FROM "blocked_locks"."objid")) AND (NOT ("blocking_locks"."objsubid" IS DISTINCT FROM "blocked_locks"."objsubid")) AND ("blocking_locks"."pid" <> "blocked_locks"."pid"))))
     JOIN "pg_stat_activity" "blocking_activity" ON (("blocking_activity"."pid" = "blocking_locks"."pid")))
  WHERE (NOT "blocked_locks"."granted");


ALTER VIEW "public"."vw_blocked_queries" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_micro_tarefas_sla" AS
 SELECT "mt"."id",
    "mt"."tarefa_id",
    "mt"."profissional_id",
    "p"."nome" AS "profissional_nome",
    "mt"."funcao",
    "mt"."status",
    "mt"."deadline_at",
    "mt"."started_at",
    "mt"."finished_at",
    "mt"."created_at",
    "mt"."updated_at",
        CASE
            WHEN ("mt"."deadline_at" IS NULL) THEN false
            WHEN (("mt"."status" = 'concluida'::"text") AND ("mt"."finished_at" > "mt"."deadline_at")) THEN true
            WHEN (("mt"."status" <> 'concluida'::"text") AND ("now"() > "mt"."deadline_at")) THEN true
            ELSE false
        END AS "atrasada",
    (
        CASE
            WHEN ("mt"."deadline_at" IS NULL) THEN NULL::numeric
            WHEN (("mt"."status" = 'concluida'::"text") AND ("mt"."finished_at" > "mt"."deadline_at")) THEN (EXTRACT(epoch FROM ("mt"."finished_at" - "mt"."deadline_at")) / (60)::numeric)
            WHEN (("mt"."status" <> 'concluida'::"text") AND ("now"() > "mt"."deadline_at")) THEN (EXTRACT(epoch FROM ("now"() - "mt"."deadline_at")) / (60)::numeric)
            ELSE NULL::numeric
        END)::integer AS "tempo_atraso_minutos",
    (
        CASE
            WHEN (("mt"."started_at" IS NOT NULL) AND ("mt"."finished_at" IS NULL)) THEN (EXTRACT(epoch FROM ("now"() - "mt"."started_at")) / (60)::numeric)
            ELSE NULL::numeric
        END)::integer AS "tempo_execucao_minutos",
    (
        CASE
            WHEN (("mt"."status" = 'concluida'::"text") AND ("mt"."finished_at" IS NOT NULL)) THEN (EXTRACT(epoch FROM ("mt"."finished_at" - "mt"."created_at")) / (60)::numeric)
            ELSE NULL::numeric
        END)::integer AS "tempo_total_conclusao_minutos",
        CASE
            WHEN ("mt"."deadline_at" IS NULL) THEN 'sem_sla'::"text"
            WHEN (("mt"."status" = 'concluida'::"text") AND ("mt"."finished_at" <= "mt"."deadline_at")) THEN 'concluida_no_prazo'::"text"
            WHEN (("mt"."status" = 'concluida'::"text") AND ("mt"."finished_at" > "mt"."deadline_at")) THEN 'concluida_atrasada'::"text"
            WHEN ("now"() > "mt"."deadline_at") THEN 'atrasada'::"text"
            WHEN ("now"() > ("mt"."deadline_at" - '02:00:00'::interval)) THEN 'proximo_do_prazo'::"text"
            ELSE 'no_prazo'::"text"
        END AS "status_sla"
   FROM ("public"."tarefas_micro" "mt"
     LEFT JOIN "public"."profissionais" "p" ON (("mt"."profissional_id" = "p"."id")));


ALTER VIEW "public"."vw_micro_tarefas_sla" OWNER TO "postgres";


COMMENT ON VIEW "public"."vw_micro_tarefas_sla" IS 'Optimized view for micro task SLA queries with dynamic calculations. Tasks with deadline_at=NULL have status_sla=sem_sla';



CREATE OR REPLACE VIEW "public"."vw_notification_queue_alerts" AS
 SELECT
        CASE
            WHEN ("pending_count" > 1000) THEN '🔴 CRITICAL'::"text"
            WHEN ("pending_count" > 500) THEN '🟠 WARNING'::"text"
            WHEN ("oldest_age_seconds" > 300) THEN '🟡 DELAYED'::"text"
            ELSE '✅ OK'::"text"
        END AS "alert_level",
    "pending_count",
    "oldest_age_seconds",
        CASE
            WHEN ("pending_count" > 1000) THEN 'Queue depth exceeds 1000'::"text"
            WHEN ("oldest_age_seconds" > 300) THEN 'Oldest pending > 5min'::"text"
            ELSE 'System healthy'::"text"
        END AS "message",
    "now"() AS "checked_at"
   FROM ( SELECT COALESCE("count"(*) FILTER (WHERE ("notification_queue"."status" = 'pending'::"text")), (0)::bigint) AS "pending_count",
            COALESCE((EXTRACT(epoch FROM ("now"() - "min"("notification_queue"."created_at") FILTER (WHERE ("notification_queue"."status" = 'pending'::"text")))))::integer, 0) AS "oldest_age_seconds"
           FROM "public"."notification_queue"
          WHERE ("notification_queue"."created_at" > ("now"() - '01:00:00'::interval))) "stats";


ALTER VIEW "public"."vw_notification_queue_alerts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_notification_queue_health" AS
 SELECT "status",
    "count"(*) AS "count",
    "min"("created_at") AS "oldest",
    "max"("created_at") AS "newest",
    (EXTRACT(epoch FROM ("now"() - "min"("created_at"))))::integer AS "oldest_age_seconds",
        CASE
            WHEN (("status" = 'pending'::"text") AND (EXTRACT(epoch FROM ("now"() - "min"("created_at"))) > (300)::numeric)) THEN '🔴 CRITICAL'::"text"
            WHEN (("status" = 'pending'::"text") AND ("count"(*) > 1000)) THEN '🟠 WARNING'::"text"
            WHEN (("status" = 'pending'::"text") AND ("count"(*) > 100)) THEN '🟡 CAUTION'::"text"
            ELSE '✅ OK'::"text"
        END AS "health_status"
   FROM "public"."notification_queue"
  WHERE ("created_at" > ("now"() - '01:00:00'::interval))
  GROUP BY "status";


ALTER VIEW "public"."vw_notification_queue_health" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vw_ordem_diagnostics" AS
 SELECT "tm"."tarefa_id",
    "t"."titulo" AS "os_titulo",
    "count"(*) AS "total_etapas",
    "min"("tm"."ordem") AS "menor_ordem",
    "max"("tm"."ordem") AS "maior_ordem",
    "array_agg"((ROW("tm"."ordem", "p"."nome", "tm"."funcao", "tm"."status"))::"text" ORDER BY "tm"."ordem") AS "etapas_detalhes"
   FROM (("public"."tarefas_micro" "tm"
     JOIN "public"."tarefas" "t" ON (("t"."id" = "tm"."tarefa_id")))
     JOIN "public"."profissionais" "p" ON (("p"."id" = "tm"."profissional_id")))
  WHERE ("tm"."ordem" IS NOT NULL)
  GROUP BY "tm"."tarefa_id", "t"."titulo"
  ORDER BY "tm"."tarefa_id";


ALTER VIEW "public"."vw_ordem_diagnostics" OWNER TO "postgres";


COMMENT ON VIEW "public"."vw_ordem_diagnostics" IS 'View para diagnosticar distribuição de ordem nas OSs. Use: SELECT * FROM vw_ordem_diagnostics LIMIT 10;';



CREATE OR REPLACE VIEW "public"."vw_slow_queries" AS
 SELECT "substring"("query", 1, 150) AS "query_snippet",
    "calls",
    "round"((("total_exec_time")::numeric / (1000)::numeric), 4) AS "total_seconds",
    "round"(("mean_exec_time")::numeric, 2) AS "mean_ms",
    "round"(("max_exec_time")::numeric, 2) AS "max_ms",
    "rows"
   FROM "extensions"."pg_stat_statements"
  WHERE (("query" !~~* '%pg_stat_statements%'::"text") AND ("query" !~~* '%pg_catalog%'::"text") AND ("query" !~~* '%information_schema%'::"text") AND (("query" ~~* 'SELECT%'::"text") OR ("query" ~~* 'INSERT%'::"text") OR ("query" ~~* 'UPDATE%'::"text") OR ("query" ~~* 'DELETE%'::"text")) AND ("calls" > 5))
  ORDER BY "mean_exec_time" DESC
 LIMIT 50;


ALTER VIEW "public"."vw_slow_queries" OWNER TO "postgres";


COMMENT ON VIEW "public"."vw_slow_queries" IS 'Top 50 slowest application queries. NOTE: p95/p99 are not available in pg_stat_statements standard view.';



CREATE OR REPLACE VIEW "public"."vw_table_sizes" AS
 SELECT "relname" AS "table_name",
    "pg_size_pretty"("pg_total_relation_size"(("relid")::"regclass")) AS "total_size",
    "pg_size_pretty"("pg_relation_size"(("relid")::"regclass")) AS "data_size",
    "pg_size_pretty"(("pg_total_relation_size"(("relid")::"regclass") - "pg_relation_size"(("relid")::"regclass"))) AS "index_size",
    "n_live_tup" AS "live_csv_rows_estimate"
   FROM "pg_stat_user_tables"
  ORDER BY ("pg_total_relation_size"(("relid")::"regclass")) DESC;


ALTER VIEW "public"."vw_table_sizes" OWNER TO "postgres";


ALTER TABLE ONLY "ap"."candidate_news"
    ADD CONSTRAINT "candidate_news_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."candidate_scores"
    ADD CONSTRAINT "candidate_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."editorial_humanization"
    ADD CONSTRAINT "editorial_humanization_cliente_id_key" UNIQUE ("cliente_id");



ALTER TABLE ONLY "ap"."editorial_humanization"
    ADD CONSTRAINT "editorial_humanization_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."editorial_limits"
    ADD CONSTRAINT "editorial_limits_cliente_id_key" UNIQUE ("cliente_id");



ALTER TABLE ONLY "ap"."editorial_limits"
    ADD CONSTRAINT "editorial_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."editorial_logs"
    ADD CONSTRAINT "editorial_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."editorial_prompt_versions"
    ADD CONSTRAINT "editorial_prompt_versions_cliente_id_version_number_key" UNIQUE ("cliente_id", "version_number");



ALTER TABLE ONLY "ap"."editorial_prompt_versions"
    ADD CONSTRAINT "editorial_prompt_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."editorial_rag_documents"
    ADD CONSTRAINT "editorial_rag_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."editorial_rules"
    ADD CONSTRAINT "editorial_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."editorial_settings"
    ADD CONSTRAINT "editorial_settings_cliente_id_key" UNIQUE ("cliente_id");



ALTER TABLE ONLY "ap"."editorial_settings"
    ADD CONSTRAINT "editorial_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."learning_history"
    ADD CONSTRAINT "learning_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."patrocinadores"
    ADD CONSTRAINT "patrocinadores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."sources"
    ADD CONSTRAINT "sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ap"."candidate_news"
    ADD CONSTRAINT "uq_ap_news_url_cliente" UNIQUE ("url_original", "cliente_id");



ALTER TABLE ONLY "ap"."candidate_scores"
    ADD CONSTRAINT "uq_ap_scores_news" UNIQUE ("news_id");



ALTER TABLE ONLY "ap"."sources"
    ADD CONSTRAINT "uq_ap_sources" UNIQUE ("cliente_id", "url");



ALTER TABLE ONLY "public"."anexos"
    ADD CONSTRAINT "anexos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."areas"
    ADD CONSTRAINT "areas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."arquivos_tarefas"
    ADD CONSTRAINT "arquivos_tarefas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cidades"
    ADD CONSTRAINT "cidades_dominio_key" UNIQUE ("dominio");



ALTER TABLE ONLY "public"."cidades"
    ADD CONSTRAINT "cidades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cidades"
    ADD CONSTRAINT "cidades_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."cliente_profissionais"
    ADD CONSTRAINT "cliente_profissionais_cliente_id_profissional_id_funcao_key" UNIQUE ("cliente_id", "profissional_id", "funcao");



ALTER TABLE ONLY "public"."cliente_profissionais"
    ADD CONSTRAINT "cliente_profissionais_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comentarios"
    ADD CONSTRAINT "comentarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."departamentos"
    ADD CONSTRAINT "departamentos_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."departamentos"
    ADD CONSTRAINT "departamentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empresa_profissionais"
    ADD CONSTRAINT "empresa_profissionais_empresa_id_profissional_id_funcao_key" UNIQUE ("empresa_id", "profissional_id", "funcao");



ALTER TABLE ONLY "public"."empresa_profissionais"
    ADD CONSTRAINT "empresa_profissionais_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empresa_profissionais"
    ADD CONSTRAINT "empresa_profissionais_unique" UNIQUE ("empresa_id", "profissional_id");



ALTER TABLE ONLY "public"."empresas"
    ADD CONSTRAINT "empresas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."empresas"
    ADD CONSTRAINT "empresas_slug_unique" UNIQUE ("slug");



ALTER TABLE ONLY "public"."feed_posts"
    ADD CONSTRAINT "feed_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."historico_status"
    ADD CONSTRAINT "historico_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."logs_tarefas"
    ADD CONSTRAINT "logs_tarefas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notificacoes"
    ADD CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_queue"
    ADD CONSTRAINT "notification_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."os_eventos"
    ADD CONSTRAINT "os_eventos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overdue_notifications_log"
    ADD CONSTRAINT "overdue_notifications_log_pkey" PRIMARY KEY ("tarefa_id");



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_profissional_id_endpoint_key" UNIQUE ("profissional_id", "endpoint");



ALTER TABLE ONLY "public"."reunioes_participantes"
    ADD CONSTRAINT "reunioes_participantes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reunioes_participantes"
    ADD CONSTRAINT "reunioes_participantes_unique" UNIQUE ("reuniao_id", "profissional_id");



ALTER TABLE ONLY "public"."reunioes"
    ADD CONSTRAINT "reunioes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."secretarias"
    ADD CONSTRAINT "secretarias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."solicitacoes"
    ADD CONSTRAINT "solicitacoes_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."solicitacoes"
    ADD CONSTRAINT "solicitacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."solicitacoes"
    ADD CONSTRAINT "solicitacoes_protocolo_key" UNIQUE ("protocolo");



ALTER TABLE ONLY "public"."tarefas_micro_logs"
    ADD CONSTRAINT "tarefas_micro_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tarefas_micro"
    ADD CONSTRAINT "tarefas_micro_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tarefas"
    ADD CONSTRAINT "tarefas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_history"
    ADD CONSTRAINT "task_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tipos_solicitacao"
    ADD CONSTRAINT "tipos_solicitacao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_cpf_key" UNIQUE ("cpf");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_ap_learning_lookup" ON "ap"."learning_history" USING "btree" ("cliente_id", "registrado_at" DESC);



CREATE INDEX "idx_ap_news_agendado" ON "ap"."candidate_news" USING "btree" ("horario_agendado") WHERE ("status" = 'queued_for_posting'::"text");



CREATE INDEX "idx_ap_news_cliente_status" ON "ap"."candidate_news" USING "btree" ("cliente_id", "status");



CREATE INDEX "idx_ap_news_raw" ON "ap"."candidate_news" USING "btree" ("cliente_id", "created_at") WHERE ("status" = 'raw'::"text");



CREATE INDEX "idx_ap_news_ready" ON "ap"."candidate_news" USING "btree" ("cliente_id") WHERE ("status" = 'ready_for_scoring'::"text");



CREATE INDEX "idx_ap_news_render" ON "ap"."candidate_news" USING "btree" ("cliente_id") WHERE ("status" = 'pending_render'::"text");



CREATE INDEX "idx_ap_news_selected" ON "ap"."candidate_news" USING "btree" ("cliente_id") WHERE ("status" = 'selected'::"text");



CREATE INDEX "idx_ap_news_stuck" ON "ap"."candidate_news" USING "btree" ("processing_started_at") WHERE ("processing_started_at" IS NOT NULL);



CREATE INDEX "idx_ap_scheduler_lookup" ON "ap"."candidate_news" USING "btree" ("cliente_id", "horario_agendado") WHERE ("status" = 'queued_for_posting'::"text");



CREATE INDEX "idx_ap_scores_cliente_total" ON "ap"."candidate_scores" USING "btree" ("cliente_id", "score_total" DESC);



CREATE INDEX "idx_ap_sources_cliente" ON "ap"."sources" USING "btree" ("cliente_id") WHERE ("ativo" = true);



CREATE INDEX "rag_embedding_cosine_idx" ON "ap"."editorial_rag_documents" USING "ivfflat" ("embedding" "public"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_areas_ativo" ON "public"."areas" USING "btree" ("ativo");



CREATE INDEX "idx_cliente_profissionais_lookup" ON "public"."cliente_profissionais" USING "btree" ("cliente_id", "profissional_id", "funcao");



CREATE INDEX "idx_clientes_empresa_id" ON "public"."clientes" USING "btree" ("empresa_id");



CREATE INDEX "idx_empresa_profissionais_ativo" ON "public"."empresa_profissionais" USING "btree" ("ativo");



CREATE INDEX "idx_empresa_profissionais_lookup" ON "public"."empresa_profissionais" USING "btree" ("profissional_id", "empresa_id") WHERE ("ativo" = true);



CREATE INDEX "idx_empresas_slug" ON "public"."empresas" USING "btree" ("slug");



CREATE INDEX "idx_feed_posts_admin" ON "public"."feed_posts" USING "btree" ("cidade_id", "status");



CREATE INDEX "idx_feed_posts_read_public" ON "public"."feed_posts" USING "btree" ("cidade_id", "published_at" DESC) WHERE (("status" = 'published'::"public"."feed_post_status") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_logs_tarefas_tarefa_id" ON "public"."logs_tarefas" USING "btree" ("tarefa_id");



CREATE INDEX "idx_notificacoes_created_at" ON "public"."notificacoes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notificacoes_lida" ON "public"."notificacoes" USING "btree" ("lida") WHERE ("lida" = false);



CREATE UNIQUE INDEX "idx_notificacoes_meeting_reminder_unique" ON "public"."notificacoes" USING "btree" ("profissional_id", (("metadata" ->> 'reuniao_id'::"text")), (("metadata" ->> 'interval_minutes'::"text"))) WHERE ((("tipo")::"text" = 'meeting_reminder'::"text") AND (("metadata" ->> 'interval_minutes'::"text") = ANY (ARRAY['10'::"text", '30'::"text", '60'::"text"])));



COMMENT ON INDEX "public"."idx_notificacoes_meeting_reminder_unique" IS 'Prevents duplicate meeting reminder notifications (10/30/60min). Does NOT block invites or updates.';



CREATE INDEX "idx_notificacoes_os_id" ON "public"."notificacoes" USING "btree" ("os_id") WHERE ("os_id" IS NOT NULL);



CREATE INDEX "idx_notificacoes_prof_unread_created" ON "public"."notificacoes" USING "btree" ("profissional_id", "created_at" DESC) WHERE ("lida" = false);



CREATE INDEX "idx_notificacoes_profissional" ON "public"."notificacoes" USING "btree" ("profissional_id");



CREATE INDEX "idx_notification_queue_cleanup" ON "public"."notification_queue" USING "btree" ("processed_at") WHERE ("status" = ANY (ARRAY['completed'::"text", 'failed'::"text"]));



CREATE INDEX "idx_notification_queue_pending" ON "public"."notification_queue" USING "btree" ("created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_notification_queue_status" ON "public"."notification_queue" USING "btree" ("status", "created_at");



CREATE UNIQUE INDEX "idx_notification_queue_unique_event" ON "public"."notification_queue" USING "btree" ("entity_id", "event_type") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));



COMMENT ON INDEX "public"."idx_notification_queue_unique_event" IS 'Prevents duplicate events in active queue';



CREATE INDEX "idx_notifications_cleared" ON "public"."notifications" USING "btree" ("cleared_at") WHERE ("cleared_at" IS NULL);



CREATE INDEX "idx_notifications_created" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_profissional" ON "public"."notifications" USING "btree" ("profissional_id");



CREATE INDEX "idx_notifications_read" ON "public"."notifications" USING "btree" ("read_at") WHERE ("read_at" IS NULL);



CREATE INDEX "idx_os_eventos_autor_id" ON "public"."os_eventos" USING "btree" ("autor_id") WHERE ("autor_id" IS NOT NULL);



CREATE INDEX "idx_os_eventos_created_at" ON "public"."os_eventos" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_os_eventos_os_id" ON "public"."os_eventos" USING "btree" ("os_id");



CREATE INDEX "idx_os_eventos_tipo" ON "public"."os_eventos" USING "btree" ("tipo");



CREATE INDEX "idx_overdue_log_last_notified" ON "public"."overdue_notifications_log" USING "btree" ("last_notified_at");



CREATE INDEX "idx_profissionais_area" ON "public"."profissionais" USING "btree" ("area_id");



CREATE INDEX "idx_profissionais_departamento" ON "public"."profissionais" USING "btree" ("departamento_id");



CREATE INDEX "idx_profissionais_last_activity" ON "public"."profissionais" USING "btree" ("last_activity_at") WHERE ("ativo" = true);



CREATE INDEX "idx_profissionais_role" ON "public"."profissionais" USING "btree" ("role");



CREATE INDEX "idx_push_subscriptions_profissional" ON "public"."push_subscriptions" USING "btree" ("profissional_id");



CREATE INDEX "idx_reunioes_criada_por" ON "public"."reunioes" USING "btree" ("criada_por");



CREATE INDEX "idx_reunioes_data_inicio" ON "public"."reunioes" USING "btree" ("data_inicio");



CREATE INDEX "idx_reunioes_empresa_data" ON "public"."reunioes" USING "btree" ("empresa_id", "data_inicio");



CREATE INDEX "idx_reunioes_empresa_id" ON "public"."reunioes" USING "btree" ("empresa_id");



CREATE INDEX "idx_reunioes_participantes_profissional" ON "public"."reunioes_participantes" USING "btree" ("profissional_id");



CREATE INDEX "idx_reunioes_participantes_reuniao" ON "public"."reunioes_participantes" USING "btree" ("reuniao_id");



CREATE INDEX "idx_reunioes_status" ON "public"."reunioes" USING "btree" ("status");



CREATE INDEX "idx_solicitacoes_metrics" ON "public"."solicitacoes" USING "btree" ("cidade_id", "status", "created_at", "data_resolucao");



CREATE INDEX "idx_tarefas_area" ON "public"."tarefas" USING "btree" ("area_id");



CREATE INDEX "idx_tarefas_assigned_to" ON "public"."tarefas" USING "btree" ("assigned_to");



CREATE INDEX "idx_tarefas_ativas" ON "public"."tarefas" USING "btree" ("empresa_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_tarefas_created_by" ON "public"."tarefas" USING "btree" ("created_by");



CREATE INDEX "idx_tarefas_deadline" ON "public"."tarefas" USING "btree" ("deadline");



CREATE INDEX "idx_tarefas_deleted_at" ON "public"."tarefas" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "idx_tarefas_departamento" ON "public"."tarefas" USING "btree" ("departamento_id");



CREATE INDEX "idx_tarefas_empresa_id" ON "public"."tarefas" USING "btree" ("empresa_id");



CREATE INDEX "idx_tarefas_empresa_status_created" ON "public"."tarefas" USING "btree" ("empresa_id", "status", "created_at" DESC);



CREATE INDEX "idx_tarefas_empresa_status_deadline" ON "public"."tarefas" USING "btree" ("empresa_id", "status", "deadline_at");



CREATE INDEX "idx_tarefas_has_micro" ON "public"."tarefas" USING "btree" ("has_micro_tasks") WHERE ("has_micro_tasks" = true);



CREATE INDEX "idx_tarefas_micro_deadline_at" ON "public"."tarefas_micro" USING "btree" ("deadline_at") WHERE ("deadline_at" IS NOT NULL);



CREATE INDEX "idx_tarefas_micro_depends_on" ON "public"."tarefas_micro" USING "btree" ("depends_on");



CREATE INDEX "idx_tarefas_micro_finished_at" ON "public"."tarefas_micro" USING "btree" ("finished_at") WHERE ("finished_at" IS NOT NULL);



CREATE INDEX "idx_tarefas_micro_logs_created_at" ON "public"."tarefas_micro_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_tarefas_micro_logs_tarefa_micro_id" ON "public"."tarefas_micro_logs" USING "btree" ("tarefa_micro_id");



CREATE INDEX "idx_tarefas_micro_ordem" ON "public"."tarefas_micro" USING "btree" ("ordem") WHERE ("ordem" IS NOT NULL);



CREATE INDEX "idx_tarefas_micro_prof_status_deadline" ON "public"."tarefas_micro" USING "btree" ("profissional_id", "status", "deadline_at");



CREATE INDEX "idx_tarefas_micro_profissional_id" ON "public"."tarefas_micro" USING "btree" ("profissional_id");



CREATE INDEX "idx_tarefas_micro_started_at" ON "public"."tarefas_micro" USING "btree" ("started_at") WHERE ("started_at" IS NOT NULL);



CREATE INDEX "idx_tarefas_micro_status" ON "public"."tarefas_micro" USING "btree" ("status");



CREATE INDEX "idx_tarefas_micro_tarefa_id" ON "public"."tarefas_micro" USING "btree" ("tarefa_id");



CREATE INDEX "idx_tarefas_micro_tarefa_ordem" ON "public"."tarefas_micro" USING "btree" ("tarefa_id", "ordem") WHERE ("ordem" IS NOT NULL);



CREATE INDEX "idx_tarefas_prioridade" ON "public"."tarefas" USING "btree" ("prioridade");



CREATE INDEX "idx_tarefas_requested_by" ON "public"."tarefas" USING "btree" ("requested_by");



CREATE INDEX "idx_tarefas_status" ON "public"."tarefas" USING "btree" ("status");



CREATE INDEX "idx_task_attachments_created_at" ON "public"."task_attachments" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_task_attachments_empresa" ON "public"."task_attachments" USING "btree" ("empresa_id");



CREATE INDEX "idx_task_attachments_tarefa" ON "public"."task_attachments" USING "btree" ("tarefa_id");



CREATE INDEX "idx_task_attachments_uploaded_by" ON "public"."task_attachments" USING "btree" ("uploaded_by");



CREATE INDEX "idx_task_comments_created_at" ON "public"."task_comments" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_task_comments_task_id" ON "public"."task_comments" USING "btree" ("task_id");



CREATE OR REPLACE TRIGGER "trg_ap_news_updated_at" BEFORE UPDATE ON "ap"."candidate_news" FOR EACH ROW EXECUTE FUNCTION "ap"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_ap_patrocinadores_updated_at" BEFORE UPDATE ON "ap"."patrocinadores" FOR EACH ROW EXECUTE FUNCTION "ap"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_ap_sources_updated_at" BEFORE UPDATE ON "ap"."sources" FOR EACH ROW EXECUTE FUNCTION "ap"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_editorial_humanization_updated" BEFORE UPDATE ON "ap"."editorial_humanization" FOR EACH ROW EXECUTE FUNCTION "ap"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_editorial_limits_updated" BEFORE UPDATE ON "ap"."editorial_limits" FOR EACH ROW EXECUTE FUNCTION "ap"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_editorial_settings_updated" BEFORE UPDATE ON "ap"."editorial_settings" FOR EACH ROW EXECUTE FUNCTION "ap"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "check_participant_empresa" BEFORE INSERT OR UPDATE ON "public"."reunioes_participantes" FOR EACH ROW EXECUTE FUNCTION "public"."validate_participant_empresa"();



COMMENT ON TRIGGER "check_participant_empresa" ON "public"."reunioes_participantes" IS 'Defensive trigger to prevent cross-tenant participant assignments. Only affects new operations, existing data is preserved.';



CREATE OR REPLACE TRIGGER "set_protocolo" BEFORE INSERT ON "public"."solicitacoes" FOR EACH ROW WHEN (("new"."protocolo" IS NULL)) EXECUTE FUNCTION "public"."generate_protocolo"();



CREATE OR REPLACE TRIGGER "trg_bootstrap_admin_tenant" AFTER INSERT OR UPDATE ON "public"."profissionais" FOR EACH ROW EXECUTE FUNCTION "public"."bootstrap_admin_tenant_link"();



COMMENT ON TRIGGER "trg_bootstrap_admin_tenant" ON "public"."profissionais" IS 'Automatically links admins to the default tenant if no link exists, ensuring integrity.';



CREATE OR REPLACE TRIGGER "trg_enforce_admin_role_requires_tenant" BEFORE INSERT OR UPDATE ON "public"."profissionais" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_admin_role_requires_tenant"();



CREATE OR REPLACE TRIGGER "trg_enforce_admin_tenant_link" BEFORE DELETE OR UPDATE ON "public"."empresa_profissionais" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_admin_tenant_link"();



CREATE OR REPLACE TRIGGER "trg_fix_comment_author_before_insert" BEFORE INSERT ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."fix_comment_author_id"();



CREATE OR REPLACE TRIGGER "trg_generate_empresa_slug" BEFORE INSERT ON "public"."empresas" FOR EACH ROW EXECUTE FUNCTION "public"."generate_empresa_slug_if_missing"();



CREATE OR REPLACE TRIGGER "trg_notify_macro_completion" AFTER UPDATE ON "public"."tarefas" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_notify_macro_completion"();

ALTER TABLE "public"."tarefas" DISABLE TRIGGER "trg_notify_macro_completion";



CREATE OR REPLACE TRIGGER "trg_notify_micro_completion_admin" AFTER UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_notify_micro_completion_admin"();

ALTER TABLE "public"."tarefas_micro" DISABLE TRIGGER "trg_notify_micro_completion_admin";



CREATE OR REPLACE TRIGGER "trg_notify_micro_devolution_admin" AFTER UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_notify_micro_devolution_admin"();

ALTER TABLE "public"."tarefas_micro" DISABLE TRIGGER "trg_notify_micro_devolution_admin";



CREATE OR REPLACE TRIGGER "trg_queue_macro_completion" AFTER UPDATE ON "public"."tarefas" FOR EACH ROW EXECUTE FUNCTION "public"."queue_macro_completion"();



CREATE OR REPLACE TRIGGER "trg_queue_micro_completion" AFTER UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."queue_micro_completion"();



CREATE OR REPLACE TRIGGER "trg_queue_micro_devolution" AFTER UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."queue_micro_devolution"();



CREATE OR REPLACE TRIGGER "trigger_check_macro_completion" AFTER UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."check_macro_task_completion"();



CREATE OR REPLACE TRIGGER "trigger_comentario_adicionado" AFTER INSERT ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_evento_comentario"();



CREATE OR REPLACE TRIGGER "trigger_dados_alterados" AFTER UPDATE ON "public"."tarefas" FOR EACH ROW WHEN ((("old"."deadline" IS DISTINCT FROM "new"."deadline") OR ("old"."titulo" IS DISTINCT FROM "new"."titulo") OR ("old"."assigned_to" IS DISTINCT FROM "new"."assigned_to"))) EXECUTE FUNCTION "public"."registrar_alteracoes_tarefa"();



COMMENT ON TRIGGER "trigger_dados_alterados" ON "public"."tarefas" IS 'ETAPA 4: Captura alterações de governança (prazo, título, responsável) e registra em os_eventos';



CREATE OR REPLACE TRIGGER "trigger_notificacoes_evento" AFTER INSERT ON "public"."os_eventos" FOR EACH ROW EXECUTE FUNCTION "public"."criar_notificacoes_evento"();



CREATE OR REPLACE TRIGGER "trigger_notify_task_assignment" AFTER INSERT OR UPDATE ON "public"."tarefas" FOR EACH ROW EXECUTE FUNCTION "public"."notify_task_assignment"();



CREATE OR REPLACE TRIGGER "trigger_os_criada" AFTER INSERT ON "public"."tarefas" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_evento_os_criada"();



CREATE OR REPLACE TRIGGER "trigger_set_micro_task_finished_at" BEFORE UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."set_micro_task_finished_at"();



CREATE OR REPLACE TRIGGER "trigger_set_micro_task_started_at" BEFORE UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."set_micro_task_started_at"();



CREATE OR REPLACE TRIGGER "trigger_status_alterado" AFTER UPDATE ON "public"."tarefas" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_evento_status_alterado"();



CREATE OR REPLACE TRIGGER "trigger_tarefas_micro_updated_at" BEFORE UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."update_tarefas_micro_timestamp"();



CREATE OR REPLACE TRIGGER "trigger_update_dependent_tasks" AFTER UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."update_dependent_tasks"();



CREATE OR REPLACE TRIGGER "trigger_update_macro_progress" AFTER INSERT OR DELETE OR UPDATE ON "public"."tarefas_micro" FOR EACH ROW EXECUTE FUNCTION "public"."update_macro_task_progress"();



CREATE OR REPLACE TRIGGER "trigger_update_tarefas_updated_at" BEFORE UPDATE ON "public"."tarefas" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_feed_posts_modtime" BEFORE UPDATE ON "public"."feed_posts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_task_comments_updated_at" BEFORE UPDATE ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "ap"."candidate_news"
    ADD CONSTRAINT "candidate_news_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."candidate_scores"
    ADD CONSTRAINT "candidate_scores_news_id_fkey" FOREIGN KEY ("news_id") REFERENCES "ap"."candidate_news"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."editorial_humanization"
    ADD CONSTRAINT "editorial_humanization_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."editorial_limits"
    ADD CONSTRAINT "editorial_limits_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."editorial_logs"
    ADD CONSTRAINT "editorial_logs_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."editorial_prompt_versions"
    ADD CONSTRAINT "editorial_prompt_versions_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."editorial_rag_documents"
    ADD CONSTRAINT "editorial_rag_documents_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."editorial_rules"
    ADD CONSTRAINT "editorial_rules_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."editorial_settings"
    ADD CONSTRAINT "editorial_settings_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."learning_history"
    ADD CONSTRAINT "learning_history_news_id_fkey" FOREIGN KEY ("news_id") REFERENCES "ap"."candidate_news"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "ap"."patrocinadores"
    ADD CONSTRAINT "patrocinadores_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "ap"."sources"
    ADD CONSTRAINT "sources_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anexos"
    ADD CONSTRAINT "anexos_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacoes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anexos"
    ADD CONSTRAINT "anexos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."arquivos_tarefas"
    ADD CONSTRAINT "arquivos_tarefas_tarefa_id_fkey" FOREIGN KEY ("tarefa_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_profissionais"
    ADD CONSTRAINT "cliente_profissionais_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente_profissionais"
    ADD CONSTRAINT "cliente_profissionais_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."comentarios"
    ADD CONSTRAINT "comentarios_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."comentarios"
    ADD CONSTRAINT "comentarios_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacoes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empresa_profissionais"
    ADD CONSTRAINT "empresa_profissionais_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empresa_profissionais"
    ADD CONSTRAINT "empresa_profissionais_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empresas"
    ADD CONSTRAINT "empresas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."empresas"("id");



ALTER TABLE ONLY "public"."feed_posts"
    ADD CONSTRAINT "feed_posts_cidade_id_fkey" FOREIGN KEY ("cidade_id") REFERENCES "public"."cidades"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."feed_posts"
    ADD CONSTRAINT "feed_posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feed_posts"
    ADD CONSTRAINT "feed_posts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."historico_status"
    ADD CONSTRAINT "historico_status_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "public"."solicitacoes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."historico_status"
    ADD CONSTRAINT "historico_status_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."logs_tarefas"
    ADD CONSTRAINT "logs_tarefas_tarefa_id_fkey" FOREIGN KEY ("tarefa_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."logs_tarefas"
    ADD CONSTRAINT "logs_tarefas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."profissionais"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notificacoes"
    ADD CONSTRAINT "notificacoes_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "public"."os_eventos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notificacoes"
    ADD CONSTRAINT "notificacoes_os_id_fkey" FOREIGN KEY ("os_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notificacoes"
    ADD CONSTRAINT "notificacoes_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."os_eventos"
    ADD CONSTRAINT "os_eventos_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "public"."profissionais"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."os_eventos"
    ADD CONSTRAINT "os_eventos_os_id_fkey" FOREIGN KEY ("os_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overdue_notifications_log"
    ADD CONSTRAINT "overdue_notifications_log_tarefa_id_fkey" FOREIGN KEY ("tarefa_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id");



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_departamento_id_fkey" FOREIGN KEY ("departamento_id") REFERENCES "public"."departamentos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profissionais"
    ADD CONSTRAINT "profissionais_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reunioes"
    ADD CONSTRAINT "reunioes_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."reunioes"
    ADD CONSTRAINT "reunioes_criada_por_fkey" FOREIGN KEY ("criada_por") REFERENCES "public"."profissionais"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reunioes"
    ADD CONSTRAINT "reunioes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reunioes_participantes"
    ADD CONSTRAINT "reunioes_participantes_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reunioes_participantes"
    ADD CONSTRAINT "reunioes_participantes_reuniao_id_fkey" FOREIGN KEY ("reuniao_id") REFERENCES "public"."reunioes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."secretarias"
    ADD CONSTRAINT "secretarias_cidade_id_fkey" FOREIGN KEY ("cidade_id") REFERENCES "public"."cidades"("id");



ALTER TABLE ONLY "public"."solicitacoes"
    ADD CONSTRAINT "solicitacoes_cidadao_id_fkey" FOREIGN KEY ("cidadao_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."solicitacoes"
    ADD CONSTRAINT "solicitacoes_cidade_id_fkey" FOREIGN KEY ("cidade_id") REFERENCES "public"."cidades"("id");



ALTER TABLE ONLY "public"."solicitacoes"
    ADD CONSTRAINT "solicitacoes_secretaria_id_fkey" FOREIGN KEY ("secretaria_id") REFERENCES "public"."secretarias"("id");



ALTER TABLE ONLY "public"."solicitacoes"
    ADD CONSTRAINT "solicitacoes_tipo_solicitacao_id_fkey" FOREIGN KEY ("tipo_solicitacao_id") REFERENCES "public"."tipos_solicitacao"("id");



ALTER TABLE ONLY "public"."tarefas"
    ADD CONSTRAINT "tarefas_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id");



ALTER TABLE ONLY "public"."tarefas"
    ADD CONSTRAINT "tarefas_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profissionais"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tarefas"
    ADD CONSTRAINT "tarefas_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profissionais"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tarefas"
    ADD CONSTRAINT "tarefas_departamento_id_fkey" FOREIGN KEY ("departamento_id") REFERENCES "public"."areas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tarefas"
    ADD CONSTRAINT "tarefas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tarefas_micro"
    ADD CONSTRAINT "tarefas_micro_depends_on_fkey" FOREIGN KEY ("depends_on") REFERENCES "public"."tarefas_micro"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tarefas_micro_logs"
    ADD CONSTRAINT "tarefas_micro_logs_from_profissional_id_fkey" FOREIGN KEY ("from_profissional_id") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."tarefas_micro_logs"
    ADD CONSTRAINT "tarefas_micro_logs_tarefa_micro_id_fkey" FOREIGN KEY ("tarefa_micro_id") REFERENCES "public"."tarefas_micro"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tarefas_micro_logs"
    ADD CONSTRAINT "tarefas_micro_logs_to_profissional_id_fkey" FOREIGN KEY ("to_profissional_id") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."tarefas_micro"
    ADD CONSTRAINT "tarefas_micro_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."tarefas_micro"
    ADD CONSTRAINT "tarefas_micro_tarefa_id_fkey" FOREIGN KEY ("tarefa_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tarefas"
    ADD CONSTRAINT "tarefas_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_tarefa_id_fkey" FOREIGN KEY ("tarefa_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_attachments"
    ADD CONSTRAINT "task_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profissionais"("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_history"
    ADD CONSTRAINT "task_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tarefas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tipos_solicitacao"
    ADD CONSTRAINT "tipos_solicitacao_cidade_id_fkey" FOREIGN KEY ("cidade_id") REFERENCES "public"."cidades"("id");



ALTER TABLE ONLY "public"."tipos_solicitacao"
    ADD CONSTRAINT "tipos_solicitacao_secretaria_id_fkey" FOREIGN KEY ("secretaria_id") REFERENCES "public"."secretarias"("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_cidade_id_fkey" FOREIGN KEY ("cidade_id") REFERENCES "public"."cidades"("id");



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios"
    ADD CONSTRAINT "usuarios_secretaria_id_fkey" FOREIGN KEY ("secretaria_id") REFERENCES "public"."secretarias"("id");



CREATE POLICY "ap_learning_tenant_isolation" ON "ap"."learning_history" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "ap_news_tenant_isolation" ON "ap"."candidate_news" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "ap_patrocinadores_tenant_isolation" ON "ap"."patrocinadores" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "ap_scores_tenant_isolation" ON "ap"."candidate_scores" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "ap_sources_tenant_isolation" ON "ap"."sources" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



ALTER TABLE "ap"."candidate_news" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."candidate_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."editorial_humanization" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."editorial_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."editorial_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."editorial_prompt_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."editorial_rag_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."editorial_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."editorial_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."learning_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."patrocinadores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ap"."sources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation_editorial_humanization" ON "ap"."editorial_humanization" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "tenant_isolation_editorial_limits" ON "ap"."editorial_limits" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "tenant_isolation_editorial_logs" ON "ap"."editorial_logs" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "tenant_isolation_editorial_prompt_versions" ON "ap"."editorial_prompt_versions" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "tenant_isolation_editorial_rag_documents" ON "ap"."editorial_rag_documents" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "tenant_isolation_editorial_rules" ON "ap"."editorial_rules" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "tenant_isolation_editorial_settings" ON "ap"."editorial_settings" TO "authenticated" USING (("cliente_id" IN ( SELECT "ap"."get_user_cliente_ids"() AS "get_user_cliente_ids")));



CREATE POLICY "Admin Total Access" ON "public"."empresa_profissionais" USING ("public"."is_admin_safe"());



CREATE POLICY "Admin acesso total areas" ON "public"."areas" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true)))));



CREATE POLICY "Admin can add participants" ON "public"."reunioes_participantes" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."reunioes" "r"
  WHERE (("r"."id" = "reunioes_participantes"."reuniao_id") AND "public"."is_admin_in_empresa"("r"."empresa_id")))));



CREATE POLICY "Admin can create meetings" ON "public"."reunioes" FOR INSERT WITH CHECK ("public"."is_admin_in_empresa"("empresa_id"));



CREATE POLICY "Admin can delete company meetings" ON "public"."reunioes" FOR DELETE USING ("public"."is_admin_in_empresa"("empresa_id"));



CREATE POLICY "Admin can manage all companies" ON "public"."clientes" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text")))));



CREATE POLICY "Admin can remove participants" ON "public"."reunioes_participantes" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."reunioes" "r"
  WHERE (("r"."id" = "reunioes_participantes"."reuniao_id") AND "public"."is_admin_in_empresa"("r"."empresa_id")))));



CREATE POLICY "Admin can update company meetings" ON "public"."reunioes" FOR UPDATE USING ("public"."is_admin_in_empresa"("empresa_id")) WITH CHECK ("public"."is_admin_in_empresa"("empresa_id"));



CREATE POLICY "Admin can update own meetings" ON "public"."reunioes" FOR UPDATE USING (("criada_por" = "auth"."uid"()));



CREATE POLICY "Admin can update participants" ON "public"."reunioes_participantes" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."reunioes" "r"
  WHERE (("r"."id" = "reunioes_participantes"."reuniao_id") AND "public"."is_admin_in_empresa"("r"."empresa_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."reunioes" "r"
  WHERE (("r"."id" = "reunioes_participantes"."reuniao_id") AND "public"."is_admin_in_empresa"("r"."empresa_id")))));



CREATE POLICY "Admin can view all company meetings" ON "public"."reunioes" FOR SELECT USING ("public"."is_admin_in_empresa"("empresa_id"));



CREATE POLICY "Admin tem acesso total a tarefas_micro" ON "public"."tarefas_micro" USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true)))));



CREATE POLICY "Admin tem acesso total a tarefas_micro_logs" ON "public"."tarefas_micro_logs" USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true)))));



CREATE POLICY "Admin: Manage Client Links" ON "public"."cliente_profissionais" TO "authenticated" USING (("public"."is_admin_safe"() AND (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "cliente_profissionais"."cliente_id") AND ("c"."empresa_id" IN ( SELECT "empresa_profissionais"."empresa_id"
           FROM "public"."empresa_profissionais"
          WHERE (("empresa_profissionais"."profissional_id" = "auth"."uid"()) AND ("empresa_profissionais"."ativo" = true))))))))) WITH CHECK (("public"."is_admin_safe"() AND (EXISTS ( SELECT 1
   FROM "public"."clientes" "c"
  WHERE (("c"."id" = "cliente_profissionais"."cliente_id") AND ("c"."empresa_id" IN ( SELECT "empresa_profissionais"."empresa_id"
           FROM "public"."empresa_profissionais"
          WHERE (("empresa_profissionais"."profissional_id" = "auth"."uid"()) AND ("empresa_profissionais"."ativo" = true)))))))));



CREATE POLICY "Admin: Tenant Management" ON "public"."clientes" TO "authenticated" USING (("public"."is_admin_safe"() AND ("empresa_id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE (("ep"."profissional_id" = "auth"."uid"()) AND ("ep"."ativo" = true)))))) WITH CHECK (("public"."is_admin_safe"() AND ("empresa_id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE (("ep"."profissional_id" = "auth"."uid"()) AND ("ep"."ativo" = true))))));



CREATE POLICY "Admins and creators can delete tasks" ON "public"."tarefas" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true)))) OR ("created_by" = "auth"."uid"())));



COMMENT ON POLICY "Admins and creators can delete tasks" ON "public"."tarefas" IS 'Admins can delete all tasks. Task creators can delete only the tasks they created.';



CREATE POLICY "Admins can delete comments" ON "public"."task_comments" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can read city users" ON "public"."usuarios" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."tipo_perfil" = ANY (ARRAY['admin'::"text", 'master_admin'::"text"])) AND (("u"."cidade_id" = "usuarios"."cidade_id") OR ("u"."tipo_perfil" = 'master_admin'::"text"))))));



CREATE POLICY "Admins can update all tasks" ON "public"."tarefas" FOR UPDATE TO "authenticated" USING ("public"."is_admin_safe"()) WITH CHECK ("public"."is_admin_safe"());



CREATE POLICY "Admins insert notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true)))));



CREATE POLICY "Admins view all notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text") AND ("profissionais"."ativo" = true)))));



CREATE POLICY "Allow delete for authenticated users" ON "public"."departamentos" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow insert for authenticated users" ON "public"."departamentos" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow update for authenticated users" ON "public"."departamentos" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Can view participants if can view meeting" ON "public"."reunioes_participantes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."reunioes" "r"
  WHERE ("r"."id" = "reunioes_participantes"."reuniao_id"))));



CREATE POLICY "Comment on accessible tasks" ON "public"."task_comments" FOR INSERT WITH CHECK (("task_id" IN ( SELECT "tarefas"."id"
   FROM "public"."tarefas")));



CREATE POLICY "Criar evento na OS" ON "public"."os_eventos" FOR INSERT TO "authenticated" WITH CHECK (((("autor_id" IS NULL) OR ("autor_id" = "auth"."uid"())) AND "public"."is_os_participant"("os_id")));



COMMENT ON POLICY "Criar evento na OS" ON "public"."os_eventos" IS 'ETAPA 3: Participantes criam eventos (autor_id validado)';



CREATE POLICY "Editar próprio comentário" ON "public"."task_comments" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND ((("author_id" = "auth"."uid"()) AND ("created_at" > ("now"() - '00:15:00'::interval))) OR "public"."is_admin_safe"()))) WITH CHECK ((("author_id" = ( SELECT "task_comments_1"."author_id"
   FROM "public"."task_comments" "task_comments_1"
  WHERE ("task_comments_1"."id" = "task_comments_1"."id"))) AND ("task_id" = ( SELECT "task_comments_1"."task_id"
   FROM "public"."task_comments" "task_comments_1"
  WHERE ("task_comments_1"."id" = "task_comments_1"."id")))));



COMMENT ON POLICY "Editar próprio comentário" ON "public"."task_comments" IS 'ETAPA 3: Autor edita nos primeiros 15min OU admin sempre';



CREATE POLICY "Global Constraint: Delete Isolation for Companies" ON "public"."empresas" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((("public"."is_super_admin"() AND (NOT "public"."has_tenant_admin"("tenant_id"))) OR ("public"."is_admin_safe"() AND ("empresa_tipo" = 'operacional'::"text") AND "public"."is_admin_of_tenant"("tenant_id"))));



CREATE POLICY "Global Constraint: Modify Isolation for Companies" ON "public"."empresas" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((("public"."is_super_admin"() AND (NOT "public"."has_tenant_admin"("tenant_id"))) OR ("public"."is_admin_safe"() AND ("empresa_tipo" = 'operacional'::"text") AND "public"."is_admin_of_tenant"("tenant_id")))) WITH CHECK ((("public"."is_super_admin"() AND (NOT "public"."has_tenant_admin"("tenant_id"))) OR ("public"."is_admin_safe"() AND ("empresa_tipo" = 'operacional'::"text") AND "public"."is_admin_of_tenant"("tenant_id"))));



CREATE POLICY "Global Constraint: Read Isolation for Companies" ON "public"."empresas" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."empresa_profissionais" "ep"
  WHERE (("ep"."empresa_id" = "empresas"."id") AND ("ep"."profissional_id" = "auth"."uid"()) AND ("ep"."ativo" = true)))) OR ("public"."is_admin_safe"() AND ("empresa_tipo" = 'operacional'::"text") AND "public"."is_admin_of_tenant"("tenant_id"))));



CREATE POLICY "Global Constraint: Tenant Isolation for Admins" ON "public"."tarefas" AS RESTRICTIVE TO "authenticated" USING (("public"."is_super_admin"() OR
CASE
    WHEN "public"."is_admin_safe"() THEN ((EXISTS ( SELECT 1
       FROM "public"."empresa_profissionais" "ep"
      WHERE (("ep"."profissional_id" = "auth"."uid"()) AND ("ep"."empresa_id" = "tarefas"."empresa_id") AND ("ep"."ativo" = true)))) OR ("created_by" = "auth"."uid"()))
    ELSE true
END));



CREATE POLICY "Global Constraint: Tenant Isolation for Admins" ON "public"."tarefas_micro" AS RESTRICTIVE TO "authenticated" USING (
CASE
    WHEN (EXISTS ( SELECT 1
       FROM "public"."profissionais"
      WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'admin'::"text")))) THEN "public"."check_admin_micro_task_access"("id")
    ELSE true
END);



CREATE POLICY "Global Constraint: Tenant Isolation for Professionals" ON "public"."profissionais" AS RESTRICTIVE TO "authenticated" USING (("public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."empresa_profissionais" "ep1"
     JOIN "public"."empresa_profissionais" "ep2" ON (("ep1"."empresa_id" = "ep2"."empresa_id")))
  WHERE (("ep1"."profissional_id" = "auth"."uid"()) AND ("ep2"."profissional_id" = "profissionais"."id") AND ("ep1"."ativo" = true) AND ("ep2"."ativo" = true)))) OR ("id" = "auth"."uid"())));



CREATE POLICY "Global Constraint: Write Isolation for Companies" ON "public"."empresas" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((("public"."is_super_admin"() AND (NOT "public"."has_tenant_admin"("tenant_id"))) OR ("public"."is_admin_safe"() AND ("empresa_tipo" = 'operacional'::"text") AND "public"."is_admin_of_tenant"("tenant_id"))));



CREATE POLICY "Marcar como lida" ON "public"."notificacoes" FOR UPDATE TO "authenticated" USING (("profissional_id" = "auth"."uid"())) WITH CHECK ((("profissional_id" = "auth"."uid"()) AND ("lida" = ANY (ARRAY[true, false]))));



CREATE POLICY "Professionals can update accessible tasks" ON "public"."tarefas" FOR UPDATE TO "authenticated" USING (("public"."is_admin_safe"() OR ("assigned_to" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."tarefas_micro" "tm"
  WHERE (("tm"."tarefa_id" = "tarefas"."id") AND ("tm"."profissional_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin_safe"() OR ("assigned_to" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."tarefas_micro" "tm"
  WHERE (("tm"."tarefa_id" = "tarefas"."id") AND ("tm"."profissional_id" = "auth"."uid"()))))));



CREATE POLICY "Professionals can view companies" ON "public"."clientes" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."ativo" = true)))));



CREATE POLICY "Professionals update own micro tasks" ON "public"."tarefas_micro" FOR UPDATE USING (("profissional_id" = "auth"."uid"()));



CREATE POLICY "Professionals update own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("profissional_id" = "auth"."uid"())) WITH CHECK (("profissional_id" = "auth"."uid"()));



CREATE POLICY "Professionals view own micro task logs" ON "public"."tarefas_micro_logs" FOR SELECT USING (("tarefa_micro_id" IN ( SELECT "tarefas_micro"."id"
   FROM "public"."tarefas_micro"
  WHERE ("tarefas_micro"."profissional_id" = "auth"."uid"()))));



CREATE POLICY "Professionals view own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("profissional_id" = "auth"."uid"()));



CREATE POLICY "Professionals view team micro tasks" ON "public"."tarefas_micro" FOR SELECT TO "authenticated" USING ((("profissional_id" = "auth"."uid"()) OR "public"."fn_check_is_os_creator_safe"("tarefa_id")));



COMMENT ON POLICY "Professionals view team micro tasks" ON "public"."tarefas_micro" IS 'RECOVERY: Collaboration disabled. Only assignee and creator can view.';



CREATE POLICY "Profissionais veem areas ativas" ON "public"."areas" FOR SELECT TO "authenticated" USING ((("ativo" = true) AND (EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."ativo" = true))))));



CREATE POLICY "Profissional pode atualizar arquivos de suas tarefas" ON "public"."arquivos_tarefas" FOR UPDATE USING (("public"."is_active_profissional"() AND (EXISTS ( SELECT 1
   FROM "public"."tarefas"
  WHERE (("tarefas"."id" = "arquivos_tarefas"."tarefa_id") AND ("tarefas"."assigned_to" = "auth"."uid"())))))) WITH CHECK (("public"."is_active_profissional"() AND (EXISTS ( SELECT 1
   FROM "public"."tarefas"
  WHERE (("tarefas"."id" = "arquivos_tarefas"."tarefa_id") AND ("tarefas"."assigned_to" = "auth"."uid"()))))));



CREATE POLICY "Profissional pode criar solicitações" ON "public"."tarefas" FOR INSERT WITH CHECK (("public"."is_active_profissional"() AND ("created_by" = "auth"."uid"())));



CREATE POLICY "Profissional pode gerenciar arquivos de suas tarefas" ON "public"."arquivos_tarefas" FOR INSERT WITH CHECK (("public"."is_active_profissional"() AND (EXISTS ( SELECT 1
   FROM "public"."tarefas"
  WHERE (("tarefas"."id" = "arquivos_tarefas"."tarefa_id") AND ("tarefas"."assigned_to" = "auth"."uid"()))))));



CREATE POLICY "Profissional pode ver arquivos de suas tarefas" ON "public"."arquivos_tarefas" FOR SELECT USING (("public"."is_active_profissional"() AND (EXISTS ( SELECT 1
   FROM "public"."tarefas"
  WHERE (("tarefas"."id" = "arquivos_tarefas"."tarefa_id") AND (("tarefas"."assigned_to" = "auth"."uid"()) OR ("tarefas"."created_by" = "auth"."uid"())))))));



CREATE POLICY "Profissional pode ver logs de suas tarefas" ON "public"."logs_tarefas" FOR SELECT USING (("public"."is_active_profissional"() AND (EXISTS ( SELECT 1
   FROM "public"."tarefas"
  WHERE (("tarefas"."id" = "logs_tarefas"."tarefa_id") AND (("tarefas"."assigned_to" = "auth"."uid"()) OR ("tarefas"."created_by" = "auth"."uid"())))))));



CREATE POLICY "Profissional pode visualizar departamentos" ON "public"."departamentos" FOR SELECT USING ("public"."is_active_profissional"());



CREATE POLICY "Service role creates logs" ON "public"."tarefas_micro_logs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role creates micro tasks" ON "public"."tarefas_micro" FOR INSERT WITH CHECK (true);



CREATE POLICY "Sistema cria notificações" ON "public"."notificacoes" FOR INSERT TO "authenticated" WITH CHECK (("profissional_id" IS NOT NULL));



CREATE POLICY "Sistema pode inserir logs" ON "public"."logs_tarefas" FOR INSERT WITH CHECK (true);



CREATE POLICY "Staff Ver Membros Mesma Empresa" ON "public"."empresa_profissionais" FOR SELECT USING (("empresa_id" IN ( SELECT "public"."get_my_company_ids"() AS "get_my_company_ids")));



CREATE POLICY "Staff can confirm presence" ON "public"."reunioes_participantes" FOR UPDATE USING ((("profissional_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."reunioes" "r"
  WHERE (("r"."id" = "reunioes_participantes"."reuniao_id") AND ("r"."status" = ANY (ARRAY['agendada'::"text", 'em_andamento'::"text"])) AND ("r"."cancelled_at" IS NULL) AND ("now"() <= "r"."data_fim")))))) WITH CHECK ((("profissional_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."reunioes" "r"
  WHERE (("r"."id" = "reunioes_participantes"."reuniao_id") AND ("r"."status" = ANY (ARRAY['agendada'::"text", 'em_andamento'::"text"])) AND ("r"."cancelled_at" IS NULL) AND ("now"() <= "r"."data_fim"))))));



CREATE POLICY "Staff can insert comments" ON "public"."task_comments" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Staff can view company task attachments" ON "public"."task_attachments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."empresa_profissionais" "ep"
  WHERE (("ep"."profissional_id" = "auth"."uid"()) AND ("ep"."empresa_id" = "task_attachments"."empresa_id") AND ("ep"."ativo" = true)))));



CREATE POLICY "Staff can view meetings where they are participants" ON "public"."reunioes" FOR SELECT USING ("public"."is_meeting_participant"("id"));



CREATE POLICY "Staff: View Own Links" ON "public"."cliente_profissionais" FOR SELECT TO "authenticated" USING ((("profissional_id" = "auth"."uid"()) AND ("ativo" = true)));



CREATE POLICY "Super Admin Full Access" ON "public"."empresas" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'super_admin'::"text")))));



CREATE POLICY "Super Admin: Full Access" ON "public"."clientes" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "Super Admin: Full Access Link" ON "public"."cliente_profissionais" TO "authenticated" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "System insert notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Update own comments" ON "public"."task_comments" FOR UPDATE USING (("author_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own uploads or admins can delete company uploa" ON "public"."task_attachments" FOR DELETE USING ((("uploaded_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."empresa_profissionais" "ep"
     JOIN "public"."profissionais" "p" ON (("p"."id" = "ep"."profissional_id")))
  WHERE (("ep"."profissional_id" = "auth"."uid"()) AND ("ep"."empresa_id" = "task_attachments"."empresa_id") AND ("ep"."ativo" = true) AND ("p"."role" = 'admin'::"text"))))));



CREATE POLICY "Users can read own data" ON "public"."usuarios" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can upload to company tasks" ON "public"."task_attachments" FOR INSERT WITH CHECK ((("uploaded_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."empresa_profissionais" "ep"
  WHERE (("ep"."profissional_id" = "auth"."uid"()) AND ("ep"."empresa_id" = "task_attachments"."empresa_id") AND ("ep"."ativo" = true))))));



CREATE POLICY "Users delete own subscriptions" ON "public"."push_subscriptions" FOR DELETE TO "authenticated" USING (("profissional_id" = "auth"."uid"()));



CREATE POLICY "Users insert own subscriptions" ON "public"."push_subscriptions" FOR INSERT TO "authenticated" WITH CHECK (("profissional_id" = "auth"."uid"()));



CREATE POLICY "Users update own subscriptions" ON "public"."push_subscriptions" FOR UPDATE TO "authenticated" USING (("profissional_id" = "auth"."uid"())) WITH CHECK (("profissional_id" = "auth"."uid"()));



CREATE POLICY "Users view own subscriptions" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING (("profissional_id" = "auth"."uid"()));



CREATE POLICY "Ver OS atribuídas ou criadas" ON "public"."tarefas" FOR SELECT TO "authenticated" USING (("public"."is_admin_safe"() OR ("created_by" = "auth"."uid"()) OR ("assigned_to" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."tarefas_micro" "tm"
  WHERE (("tm"."tarefa_id" = "tarefas"."id") AND ("tm"."profissional_id" = "auth"."uid"()))))));



COMMENT ON POLICY "Ver OS atribuídas ou criadas" ON "public"."tarefas" IS 'ETAPA 2: Unificação de OS. Policy consolida visibilidade para OS simples (created_by, assigned_to) e complexa (micro-tasks). Usa is_admin_safe() para evitar recursão.';



CREATE POLICY "Ver colegas da mesma empresa" ON "public"."profissionais" FOR SELECT USING (("id" IN ( SELECT "public"."get_visible_colleagues"() AS "get_visible_colleagues")));



CREATE POLICY "Ver comentários da OS" ON "public"."task_comments" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."is_os_participant"("task_id")));



COMMENT ON POLICY "Ver comentários da OS" ON "public"."task_comments" IS 'ETAPA 3: Participantes veem comentários não deletados da OS';



CREATE POLICY "Ver eventos da OS" ON "public"."os_eventos" FOR SELECT TO "authenticated" USING ("public"."is_os_participant"("os_id"));



COMMENT ON POLICY "Ver eventos da OS" ON "public"."os_eventos" IS 'ETAPA 3: Participantes veem eventos da OS';



CREATE POLICY "Ver próprias notificações" ON "public"."notificacoes" FOR SELECT TO "authenticated" USING (("profissional_id" = "auth"."uid"()));



CREATE POLICY "View comments of accessible tasks" ON "public"."task_comments" FOR SELECT USING (("task_id" IN ( SELECT "tarefas"."id"
   FROM "public"."tarefas")));



CREATE POLICY "View history of accessible tasks" ON "public"."task_history" FOR SELECT USING (("task_id" IN ( SELECT "tarefas"."id"
   FROM "public"."tarefas")));



CREATE POLICY "admin_delete_tasks_v2" ON "public"."tarefas" FOR DELETE TO "authenticated" USING ((( SELECT "profissionais"."role"
   FROM "public"."profissionais"
  WHERE ("profissionais"."id" = "auth"."uid"())) = 'admin'::"text"));



CREATE POLICY "admin_empresas_delete" ON "public"."empresas" FOR DELETE TO "authenticated" USING ((("empresa_tipo" = 'operacional'::"text") AND ("tenant_id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE ("ep"."profissional_id" = "auth"."uid"())))));



CREATE POLICY "admin_empresas_insert" ON "public"."empresas" FOR INSERT TO "authenticated" WITH CHECK ((("empresa_tipo" = 'operacional'::"text") AND ("tenant_id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE ("ep"."profissional_id" = "auth"."uid"())))));



CREATE POLICY "admin_empresas_select" ON "public"."empresas" FOR SELECT TO "authenticated" USING (((("empresa_tipo" = 'operacional'::"text") AND ("tenant_id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE ("ep"."profissional_id" = "auth"."uid"())))) OR ("id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE ("ep"."profissional_id" = "auth"."uid"())))));



CREATE POLICY "admin_empresas_update" ON "public"."empresas" FOR UPDATE TO "authenticated" USING ((("empresa_tipo" = 'operacional'::"text") AND ("tenant_id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE ("ep"."profissional_id" = "auth"."uid"()))))) WITH CHECK ((("empresa_tipo" = 'operacional'::"text") AND ("tenant_id" IN ( SELECT "ep"."empresa_id"
   FROM "public"."empresa_profissionais" "ep"
  WHERE ("ep"."profissional_id" = "auth"."uid"())))));



CREATE POLICY "admin_insert_tasks_v2" ON "public"."tarefas" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "profissionais"."role"
   FROM "public"."profissionais"
  WHERE ("profissionais"."id" = "auth"."uid"())) = 'admin'::"text"));



ALTER TABLE "public"."anexos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."areas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."arquivos_tarefas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "arquivos_tarefas_admin_select" ON "public"."arquivos_tarefas" FOR SELECT USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."cidades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cliente_profissionais" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_admin_select" ON "public"."clientes" FOR SELECT USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."comentarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delete_profissionais_admin_secure" ON "public"."profissionais" FOR DELETE TO "authenticated" USING (("public"."is_active_professional"() AND ("role" = 'admin'::"text")));



CREATE POLICY "delete_profissionais_none" ON "public"."profissionais" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "delete_profissionais_own_record" ON "public"."profissionais" FOR DELETE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."departamentos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "departamentos_admin_select" ON "public"."departamentos" FOR SELECT USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."empresa_profissionais" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."empresas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feed_all_staff" ON "public"."feed_posts" USING ((((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'secretario'::"text", 'master_admin'::"text"])) AND (("cidade_id" = "public"."current_cidade_id"()) OR ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'master_admin'::"text"))));



ALTER TABLE "public"."feed_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feed_select_public" ON "public"."feed_posts" FOR SELECT USING (((("auth"."role"() = 'anon'::"text") OR ("auth"."role"() = 'authenticated'::"text")) AND ("cidade_id" = "public"."current_cidade_id"()) AND ("status" = 'published'::"public"."feed_post_status") AND ("deleted_at" IS NULL) AND (("published_at" <= "now"()) OR ("published_at" IS NULL))));



ALTER TABLE "public"."historico_status" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_profissionais_authenticated" ON "public"."profissionais" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "insert_profissionais_service_role" ON "public"."profissionais" FOR INSERT TO "service_role" WITH CHECK (true);



ALTER TABLE "public"."logs_tarefas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "logs_tarefas_admin_select" ON "public"."logs_tarefas" FOR SELECT USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."notificacoes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."os_eventos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "professionals_update_own" ON "public"."profissionais" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."profissionais" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read_cidades" ON "public"."cidades" FOR SELECT USING (true);



CREATE POLICY "public_read_secretarias" ON "public"."secretarias" FOR SELECT USING (true);



CREATE POLICY "public_read_tipos" ON "public"."tipos_solicitacao" FOR SELECT USING (true);



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reunioes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reunioes_participantes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."secretarias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_profissionais_authenticated" ON "public"."profissionais" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "select_profissionais_no_recursion" ON "public"."profissionais" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_active_professional"()));



CREATE POLICY "select_profissionais_own_record" ON "public"."profissionais" FOR SELECT USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."solicitacoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "solicitacoes_own" ON "public"."solicitacoes" USING (("auth"."uid"() = "cidadao_id"));



CREATE POLICY "super_admin_empresas_delete" ON "public"."empresas" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'super_admin'::"text")))) AND ("empresa_tipo" = 'tenant'::"text")));



CREATE POLICY "super_admin_empresas_insert" ON "public"."empresas" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'super_admin'::"text")))) AND ("empresa_tipo" = 'tenant'::"text") AND ("tenant_id" IS NULL)));



CREATE POLICY "super_admin_empresas_select" ON "public"."empresas" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'super_admin'::"text")))) AND ("empresa_tipo" = 'tenant'::"text")));



CREATE POLICY "super_admin_empresas_update" ON "public"."empresas" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'super_admin'::"text")))) AND ("empresa_tipo" = 'tenant'::"text"))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profissionais"
  WHERE (("profissionais"."id" = "auth"."uid"()) AND ("profissionais"."role" = 'super_admin'::"text")))) AND ("empresa_tipo" = 'tenant'::"text") AND ("tenant_id" IS NULL)));



ALTER TABLE "public"."tarefas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tarefas_admin_select" ON "public"."tarefas" FOR SELECT USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."tarefas_micro" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tarefas_micro_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tipos_solicitacao" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_profissionais_own" ON "public"."profissionais" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "update_profissionais_own_record" ON "public"."profissionais" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "update_profissionais_secure_definitive" ON "public"."profissionais" FOR UPDATE TO "authenticated" USING (("public"."is_active_professional"() AND (("role" = 'admin'::"text") OR ("id" = "auth"."uid"())))) WITH CHECK (("public"."is_active_professional"() AND (("role" = 'admin'::"text") OR ("id" = "auth"."uid"()))));



ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."feed_posts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."reunioes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."reunioes_participantes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tarefas";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tarefas_micro";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "ap"."refund_editorial_tokens"("p_cliente_id" "uuid", "p_tokens_to_refund" integer) TO "service_role";



GRANT ALL ON FUNCTION "ap"."reserve_editorial_tokens"("p_cliente_id" "uuid", "p_tokens" integer) TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."archive_feed_post"("p_post_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."archive_feed_post"("p_post_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_feed_post"("p_post_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_close_meetings"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_close_meetings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_close_meetings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."bootstrap_admin_tenant_link"() TO "anon";
GRANT ALL ON FUNCTION "public"."bootstrap_admin_tenant_link"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_admin_tenant_link"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bootstrap_admin_tenant_link_after"() TO "anon";
GRANT ALL ON FUNCTION "public"."bootstrap_admin_tenant_link_after"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_admin_tenant_link_after"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_create_deadline_notifications"("payloads" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_create_deadline_notifications"("payloads" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_create_deadline_notifications"("payloads" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."calcular_sla_micro_tarefa"("p_micro_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calcular_sla_micro_tarefa"("p_micro_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calcular_sla_micro_tarefa"("p_micro_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_add_micro_tasks"("p_os_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_add_micro_tasks"("p_os_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_add_micro_tasks"("p_os_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_assign_professional"("p_cliente_id" "uuid", "p_profissional_id" "uuid", "p_funcao" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_assign_professional"("p_cliente_id" "uuid", "p_profissional_id" "uuid", "p_funcao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_assign_professional"("p_cliente_id" "uuid", "p_profissional_id" "uuid", "p_funcao" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_change_deadline"("p_os_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_change_deadline"("p_os_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_change_deadline"("p_os_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_convert_to_complex"("p_os_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_convert_to_complex"("p_os_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_convert_to_complex"("p_os_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_create_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_create_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_create_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_create_workflow_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_create_workflow_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_create_workflow_os"("p_empresa_id" "uuid", "p_cliente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_delete_os"("p_os_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_delete_os"("p_os_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_delete_os"("p_os_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_update_os"("p_os_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_update_os"("p_os_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_update_os"("p_os_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_cliente"("p_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_cliente"("p_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_cliente"("p_cliente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_os"("os_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_os"("os_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_os"("os_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_admin_micro_task_access"("p_micro_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_admin_micro_task_access"("p_micro_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_admin_micro_task_access"("p_micro_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_macro_task_completion"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_macro_task_completion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_macro_task_completion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."count_unassigned_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."count_unassigned_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_unassigned_tasks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_feed_post"("p_tipo" "public"."feed_post_type", "p_titulo" "text", "p_resumo" "text", "p_corpo" "text", "p_imagem_capa" "text", "p_link_externo" "text", "p_link_texto" "text", "p_agendar_para" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."create_feed_post"("p_tipo" "public"."feed_post_type", "p_titulo" "text", "p_resumo" "text", "p_corpo" "text", "p_imagem_capa" "text", "p_link_externo" "text", "p_link_texto" "text", "p_agendar_para" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_feed_post"("p_tipo" "public"."feed_post_type", "p_titulo" "text", "p_resumo" "text", "p_corpo" "text", "p_imagem_capa" "text", "p_link_externo" "text", "p_link_texto" "text", "p_agendar_para" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_meeting_notification"("p_reuniao_id" "uuid", "p_profissional_id" "uuid", "p_titulo" "text", "p_data_inicio" timestamp with time zone, "p_interval_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_meeting_notification"("p_reuniao_id" "uuid", "p_profissional_id" "uuid", "p_titulo" "text", "p_data_inicio" timestamp with time zone, "p_interval_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_meeting_notification"("p_reuniao_id" "uuid", "p_profissional_id" "uuid", "p_titulo" "text", "p_data_inicio" timestamp with time zone, "p_interval_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_os_with_micro_tasks"("p_empresa_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline_at" timestamp with time zone, "p_workflow_stages" "jsonb", "p_drive_link" "text", "p_created_by" "uuid", "p_prioridade" "text", "p_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_os_with_micro_tasks"("p_empresa_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline_at" timestamp with time zone, "p_workflow_stages" "jsonb", "p_drive_link" "text", "p_created_by" "uuid", "p_prioridade" "text", "p_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_os_with_micro_tasks"("p_empresa_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline_at" timestamp with time zone, "p_workflow_stages" "jsonb", "p_drive_link" "text", "p_created_by" "uuid", "p_prioridade" "text", "p_cliente_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_tenant_db"("p_company_name" "text", "p_cnpj" "text", "p_admin_id" "uuid", "p_admin_name" "text", "p_admin_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_tenant_db"("p_company_name" "text", "p_cnpj" "text", "p_admin_id" "uuid", "p_admin_name" "text", "p_admin_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_tenant_db"("p_company_name" "text", "p_cnpj" "text", "p_admin_id" "uuid", "p_admin_name" "text", "p_admin_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."criar_notificacoes_evento"() TO "anon";
GRANT ALL ON FUNCTION "public"."criar_notificacoes_evento"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."criar_notificacoes_evento"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_cidade_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_cidade_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_cidade_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."debug_whoami"() TO "anon";
GRANT ALL ON FUNCTION "public"."debug_whoami"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."debug_whoami"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_admin_role_requires_tenant"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_admin_role_requires_tenant"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_admin_role_requires_tenant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_admin_tenant_link"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_admin_tenant_link"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_admin_tenant_link"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_profissional_on_auth_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_profissional_on_auth_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_profissional_on_auth_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fix_comment_author_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."fix_comment_author_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fix_comment_author_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_is_os_creator"("target_os_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_is_os_creator"("target_os_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_is_os_creator"("target_os_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_is_os_creator_safe"("target_os_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_is_os_creator_safe"("target_os_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_is_os_creator_safe"("target_os_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_check_is_os_participant"("target_os_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_check_is_os_participant"("target_os_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_check_is_os_participant"("target_os_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_empresa_slug_if_missing"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_empresa_slug_if_missing"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_empresa_slug_if_missing"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_protocolo"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_protocolo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_protocolo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_client_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_client_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_client_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_companies_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_companies_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_companies_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_identity"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_identity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_chart_data"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_chart_data"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_chart_data"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_data"("p_empresa_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_data"("p_empresa_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_data"("p_empresa_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_decrypted_secret"("secret_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_decrypted_secret"("secret_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_decrypted_secret"("secret_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_institutional_feed"("p_page" integer, "p_page_size" integer, "p_tipo_filtro" "public"."feed_post_type") TO "anon";
GRANT ALL ON FUNCTION "public"."get_institutional_feed"("p_page" integer, "p_page_size" integer, "p_tipo_filtro" "public"."feed_post_type") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_institutional_feed"("p_page" integer, "p_page_size" integer, "p_tipo_filtro" "public"."feed_post_type") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_company_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_company_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_company_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_os_permissions"("p_os_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_os_permissions"("p_os_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_os_permissions"("p_os_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_metrics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_role_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_role_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_role_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_staff_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_staff_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_staff_stats"("start_date" timestamp with time zone, "end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_super_admin_dashboard_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_super_admin_dashboard_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_super_admin_dashboard_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_tenant_details"("target_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_tenant_details"("target_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_tenant_details"("target_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_upcoming_meeting_notifications"("interval_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_upcoming_meeting_notifications"("interval_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_upcoming_meeting_notifications"("interval_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_visible_colleagues"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_visible_colleagues"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_visible_colleagues"() TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_active_tenant_link"("prof_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_active_tenant_link"("prof_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_active_tenant_link"("prof_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_tenant_admin"("target_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_tenant_admin"("target_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_tenant_admin"("target_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."identificar_gargalo"("p_tarefa_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."identificar_gargalo"("p_tarefa_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."identificar_gargalo"("p_tarefa_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_professional"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_professional"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_professional"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_profissional"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_profissional"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_profissional"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_in_empresa"("empresa_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_in_empresa"("empresa_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_in_empresa"("empresa_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_of_tenant"("target_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_of_tenant"("target_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_of_tenant"("target_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_safe"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_safe"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_safe"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_meeting_participant"("reuniao_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_meeting_participant"("reuniao_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_meeting_participant"("reuniao_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_os_participant"("p_os_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_os_participant"("p_os_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_os_participant"("p_os_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_task_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_task_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_task_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_all_notifications_as_read"("p_profissional_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_as_read"("p_profissional_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_as_read"("p_profissional_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_admins_and_managers"("p_title" "text", "p_message" "text", "p_link" "text", "p_type" "text", "p_entity_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_admins_and_managers"("p_title" "text", "p_message" "text", "p_link" "text", "p_type" "text", "p_entity_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_admins_and_managers"("p_title" "text", "p_message" "text", "p_link" "text", "p_type" "text", "p_entity_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_meeting_presence"("p_reuniao_id" "uuid", "p_participante_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_meeting_presence"("p_reuniao_id" "uuid", "p_participante_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_meeting_presence"("p_reuniao_id" "uuid", "p_participante_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_task_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_task_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_task_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_task_completion"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_task_completion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_task_completion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_task_details_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_task_details_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_task_details_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_task_requested"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_task_requested"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_task_requested"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_notification_queue"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_notification_queue"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_notification_queue"() TO "service_role";



GRANT ALL ON FUNCTION "public"."publish_feed_post"("p_post_id" "uuid", "p_disparar_push" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."publish_feed_post"("p_post_id" "uuid", "p_disparar_push" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_feed_post"("p_post_id" "uuid", "p_disparar_push" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_macro_completion"() TO "anon";
GRANT ALL ON FUNCTION "public"."queue_macro_completion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_macro_completion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_micro_completion"() TO "anon";
GRANT ALL ON FUNCTION "public"."queue_micro_completion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_micro_completion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_micro_devolution"() TO "anon";
GRANT ALL ON FUNCTION "public"."queue_micro_devolution"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_micro_devolution"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_alteracoes_tarefa"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_alteracoes_tarefa"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_alteracoes_tarefa"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_evento_comentario"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_evento_comentario"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_evento_comentario"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_evento_os_criada"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_evento_os_criada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_evento_os_criada"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_evento_status_alterado"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_evento_status_alterado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_evento_status_alterado"() TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_current_city_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_current_city_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_current_city_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_abrir_solicitacao"("p_tipo_solicitacao_id" "uuid", "p_tipo_ocorrencia" "text", "p_titulo" "text", "p_descricao" "text", "p_endereco" "text", "p_latitude" double precision, "p_longitude" double precision, "p_foto_url" "text", "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_abrir_solicitacao"("p_tipo_solicitacao_id" "uuid", "p_tipo_ocorrencia" "text", "p_titulo" "text", "p_descricao" "text", "p_endereco" "text", "p_latitude" double precision, "p_longitude" double precision, "p_foto_url" "text", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_abrir_solicitacao"("p_tipo_solicitacao_id" "uuid", "p_tipo_ocorrencia" "text", "p_titulo" "text", "p_descricao" "text", "p_endereco" "text", "p_latitude" double precision, "p_longitude" double precision, "p_foto_url" "text", "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_adicionar_anexo"("p_solicitacao_id" "uuid", "p_url" "text", "p_tipo" "text", "p_nome" "text", "p_tamanho" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_adicionar_anexo"("p_solicitacao_id" "uuid", "p_url" "text", "p_tipo" "text", "p_nome" "text", "p_tamanho" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_adicionar_anexo"("p_solicitacao_id" "uuid", "p_url" "text", "p_tipo" "text", "p_nome" "text", "p_tamanho" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_adicionar_comentario"("p_solicitacao_id" "uuid", "p_texto" "text", "p_interno" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_adicionar_comentario"("p_solicitacao_id" "uuid", "p_texto" "text", "p_interno" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_adicionar_comentario"("p_solicitacao_id" "uuid", "p_texto" "text", "p_interno" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_atualizar_status_solicitacao"("p_solicitacao_id" "uuid", "p_novo_status" "text", "p_observacao_historico" "text", "p_comentario_resolucao" "text", "p_fotos_resolucao" "text"[], "p_comentario_adicional" "text", "p_interno" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_atualizar_status_solicitacao"("p_solicitacao_id" "uuid", "p_novo_status" "text", "p_observacao_historico" "text", "p_comentario_resolucao" "text", "p_fotos_resolucao" "text"[], "p_comentario_adicional" "text", "p_interno" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_atualizar_status_solicitacao"("p_solicitacao_id" "uuid", "p_novo_status" "text", "p_observacao_historico" "text", "p_comentario_resolucao" "text", "p_fotos_resolucao" "text"[], "p_comentario_adicional" "text", "p_interno" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_micro_task_finished_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_micro_task_finished_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_micro_task_finished_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_micro_task_started_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_micro_task_started_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_micro_task_started_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_requested_by_if_null"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_requested_by_if_null"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_requested_by_if_null"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_tarefas_concluida_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_tarefas_concluida_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tarefas_concluida_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_notify_macro_completion"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_notify_macro_completion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_notify_macro_completion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_notify_micro_completion_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_notify_micro_completion_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_notify_micro_completion_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_notify_micro_devolution_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_notify_micro_devolution_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_notify_micro_devolution_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_send_push_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_send_push_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_send_push_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_dependent_tasks"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_dependent_tasks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_dependent_tasks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_empresa_funcoes_permitidas_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_empresa_funcoes_permitidas_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_empresa_funcoes_permitidas_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_empresa_profissionais_permitidos_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_empresa_profissionais_permitidos_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_empresa_profissionais_permitidos_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_macro_task_progress"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_macro_task_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_macro_task_progress"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_os"("p_os_id" "uuid", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_os"("p_os_id" "uuid", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_os"("p_os_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline" timestamp with time zone, "p_prioridade" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline" timestamp with time zone, "p_prioridade" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_os_v2"("p_os_id" "uuid", "p_titulo" "text", "p_descricao" "text", "p_deadline" timestamp with time zone, "p_prioridade" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_tarefa_status_from_itens"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_tarefa_status_from_itens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_tarefa_status_from_itens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_tarefas_micro_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_tarefas_micro_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_tarefas_micro_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_profissional_empresa"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_profissional_empresa"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_profissional_empresa"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_participant_empresa"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_participant_empresa"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_participant_empresa"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";















GRANT ALL ON TABLE "public"."anexos" TO "anon";
GRANT ALL ON TABLE "public"."anexos" TO "authenticated";
GRANT ALL ON TABLE "public"."anexos" TO "service_role";



GRANT ALL ON TABLE "public"."areas" TO "anon";
GRANT ALL ON TABLE "public"."areas" TO "authenticated";
GRANT ALL ON TABLE "public"."areas" TO "service_role";



GRANT ALL ON TABLE "public"."arquivos_tarefas" TO "anon";
GRANT ALL ON TABLE "public"."arquivos_tarefas" TO "authenticated";
GRANT ALL ON TABLE "public"."arquivos_tarefas" TO "service_role";



GRANT ALL ON TABLE "public"."cidades" TO "anon";
GRANT ALL ON TABLE "public"."cidades" TO "authenticated";
GRANT ALL ON TABLE "public"."cidades" TO "service_role";



GRANT ALL ON TABLE "public"."cliente_profissionais" TO "anon";
GRANT ALL ON TABLE "public"."cliente_profissionais" TO "authenticated";
GRANT ALL ON TABLE "public"."cliente_profissionais" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "anon";
GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."comentarios" TO "anon";
GRANT ALL ON TABLE "public"."comentarios" TO "authenticated";
GRANT ALL ON TABLE "public"."comentarios" TO "service_role";



GRANT ALL ON TABLE "public"."departamentos" TO "anon";
GRANT ALL ON TABLE "public"."departamentos" TO "authenticated";
GRANT ALL ON TABLE "public"."departamentos" TO "service_role";



GRANT ALL ON TABLE "public"."empresa_profissionais" TO "anon";
GRANT ALL ON TABLE "public"."empresa_profissionais" TO "authenticated";
GRANT ALL ON TABLE "public"."empresa_profissionais" TO "service_role";



GRANT ALL ON TABLE "public"."empresa_profissionais_backup_2026_01_12" TO "anon";
GRANT ALL ON TABLE "public"."empresa_profissionais_backup_2026_01_12" TO "authenticated";
GRANT ALL ON TABLE "public"."empresa_profissionais_backup_2026_01_12" TO "service_role";



GRANT ALL ON TABLE "public"."empresas" TO "anon";
GRANT ALL ON TABLE "public"."empresas" TO "authenticated";
GRANT ALL ON TABLE "public"."empresas" TO "service_role";



GRANT ALL ON TABLE "public"."feed_posts" TO "anon";
GRANT ALL ON TABLE "public"."feed_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."feed_posts" TO "service_role";



GRANT ALL ON TABLE "public"."historico_status" TO "anon";
GRANT ALL ON TABLE "public"."historico_status" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_status" TO "service_role";



GRANT ALL ON TABLE "public"."logs_tarefas" TO "anon";
GRANT ALL ON TABLE "public"."logs_tarefas" TO "authenticated";
GRANT ALL ON TABLE "public"."logs_tarefas" TO "service_role";



GRANT ALL ON TABLE "public"."notificacoes" TO "anon";
GRANT ALL ON TABLE "public"."notificacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."notificacoes" TO "service_role";



GRANT ALL ON TABLE "public"."notification_queue" TO "anon";
GRANT ALL ON TABLE "public"."notification_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_queue" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."tarefas" TO "anon";
GRANT ALL ON TABLE "public"."tarefas" TO "authenticated";
GRANT ALL ON TABLE "public"."tarefas" TO "service_role";



GRANT ALL ON TABLE "public"."os_dashboard_summary" TO "anon";
GRANT ALL ON TABLE "public"."os_dashboard_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."os_dashboard_summary" TO "service_role";



GRANT ALL ON TABLE "public"."os_eventos" TO "anon";
GRANT ALL ON TABLE "public"."os_eventos" TO "authenticated";
GRANT ALL ON TABLE "public"."os_eventos" TO "service_role";



GRANT ALL ON TABLE "public"."profissionais" TO "anon";
GRANT ALL ON TABLE "public"."profissionais" TO "authenticated";
GRANT ALL ON TABLE "public"."profissionais" TO "service_role";



GRANT ALL ON TABLE "public"."task_comments" TO "anon";
GRANT ALL ON TABLE "public"."task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comments" TO "service_role";



GRANT ALL ON TABLE "public"."os_timeline_view" TO "anon";
GRANT ALL ON TABLE "public"."os_timeline_view" TO "authenticated";
GRANT ALL ON TABLE "public"."os_timeline_view" TO "service_role";



GRANT ALL ON TABLE "public"."overdue_notifications_log" TO "anon";
GRANT ALL ON TABLE "public"."overdue_notifications_log" TO "authenticated";
GRANT ALL ON TABLE "public"."overdue_notifications_log" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."reunioes" TO "anon";
GRANT ALL ON TABLE "public"."reunioes" TO "authenticated";
GRANT ALL ON TABLE "public"."reunioes" TO "service_role";



GRANT ALL ON TABLE "public"."reunioes_participantes" TO "anon";
GRANT ALL ON TABLE "public"."reunioes_participantes" TO "authenticated";
GRANT ALL ON TABLE "public"."reunioes_participantes" TO "service_role";



GRANT ALL ON TABLE "public"."secretarias" TO "anon";
GRANT ALL ON TABLE "public"."secretarias" TO "authenticated";
GRANT ALL ON TABLE "public"."secretarias" TO "service_role";



GRANT ALL ON TABLE "public"."solicitacoes" TO "anon";
GRANT ALL ON TABLE "public"."solicitacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."solicitacoes" TO "service_role";



GRANT ALL ON TABLE "public"."tarefas_backup_20260112" TO "anon";
GRANT ALL ON TABLE "public"."tarefas_backup_20260112" TO "authenticated";
GRANT ALL ON TABLE "public"."tarefas_backup_20260112" TO "service_role";



GRANT ALL ON TABLE "public"."tarefas_com_status_real" TO "anon";
GRANT ALL ON TABLE "public"."tarefas_com_status_real" TO "authenticated";
GRANT ALL ON TABLE "public"."tarefas_com_status_real" TO "service_role";



GRANT ALL ON TABLE "public"."tarefas_micro" TO "anon";
GRANT ALL ON TABLE "public"."tarefas_micro" TO "authenticated";
GRANT ALL ON TABLE "public"."tarefas_micro" TO "service_role";



GRANT ALL ON TABLE "public"."tarefas_micro_logs" TO "anon";
GRANT ALL ON TABLE "public"."tarefas_micro_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."tarefas_micro_logs" TO "service_role";



GRANT ALL ON TABLE "public"."task_attachments" TO "anon";
GRANT ALL ON TABLE "public"."task_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."task_history" TO "anon";
GRANT ALL ON TABLE "public"."task_history" TO "authenticated";
GRANT ALL ON TABLE "public"."task_history" TO "service_role";



GRANT ALL ON TABLE "public"."tipos_solicitacao" TO "anon";
GRANT ALL ON TABLE "public"."tipos_solicitacao" TO "authenticated";
GRANT ALL ON TABLE "public"."tipos_solicitacao" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios" TO "anon";
GRANT ALL ON TABLE "public"."usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."v_feed_institucional_publico" TO "anon";
GRANT ALL ON TABLE "public"."v_feed_institucional_publico" TO "authenticated";
GRANT ALL ON TABLE "public"."v_feed_institucional_publico" TO "service_role";



GRANT ALL ON TABLE "public"."vw_active_locks" TO "anon";
GRANT ALL ON TABLE "public"."vw_active_locks" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_active_locks" TO "service_role";



GRANT ALL ON TABLE "public"."vw_admin_tenant_compliance" TO "anon";
GRANT ALL ON TABLE "public"."vw_admin_tenant_compliance" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_admin_tenant_compliance" TO "service_role";



GRANT ALL ON TABLE "public"."vw_blocked_queries" TO "anon";
GRANT ALL ON TABLE "public"."vw_blocked_queries" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_blocked_queries" TO "service_role";



GRANT ALL ON TABLE "public"."vw_micro_tarefas_sla" TO "anon";
GRANT ALL ON TABLE "public"."vw_micro_tarefas_sla" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_micro_tarefas_sla" TO "service_role";



GRANT ALL ON TABLE "public"."vw_notification_queue_alerts" TO "anon";
GRANT ALL ON TABLE "public"."vw_notification_queue_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_notification_queue_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."vw_notification_queue_health" TO "anon";
GRANT ALL ON TABLE "public"."vw_notification_queue_health" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_notification_queue_health" TO "service_role";



GRANT ALL ON TABLE "public"."vw_ordem_diagnostics" TO "anon";
GRANT ALL ON TABLE "public"."vw_ordem_diagnostics" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_ordem_diagnostics" TO "service_role";



GRANT ALL ON TABLE "public"."vw_slow_queries" TO "anon";
GRANT ALL ON TABLE "public"."vw_slow_queries" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_slow_queries" TO "service_role";



GRANT ALL ON TABLE "public"."vw_table_sizes" TO "anon";
GRANT ALL ON TABLE "public"."vw_table_sizes" TO "authenticated";
GRANT ALL ON TABLE "public"."vw_table_sizes" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.ensure_profissional_on_auth_user();


  create policy "Admins can delete company uploads"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'task-attachments'::text) AND (auth.role() = 'authenticated'::text) AND (EXISTS ( SELECT 1
   FROM (public.empresa_profissionais ep
     JOIN public.profissionais p ON ((p.id = ep.profissional_id)))
  WHERE ((ep.profissional_id = auth.uid()) AND ((ep.empresa_id)::text = (storage.foldername(objects.name))[1]) AND (p.role = 'admin'::text))))));



  create policy "Company members can view attachments"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'task-attachments'::text) AND (auth.role() = 'authenticated'::text) AND (EXISTS ( SELECT 1
   FROM public.empresa_profissionais ep
  WHERE ((ep.profissional_id = auth.uid()) AND ((ep.empresa_id)::text = (storage.foldername(objects.name))[1]) AND (ep.ativo = true))))));



  create policy "Users can delete own uploads"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'task-attachments'::text) AND (auth.uid() = owner)));



  create policy "Users can upload to company folder"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'task-attachments'::text) AND (auth.role() = 'authenticated'::text) AND (EXISTS ( SELECT 1
   FROM public.empresa_profissionais ep
  WHERE ((ep.profissional_id = auth.uid()) AND ((ep.empresa_id)::text = (storage.foldername(objects.name))[1]) AND (ep.ativo = true))))));



