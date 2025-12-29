import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const {
            empresa_id,
            titulo,
            descricao,
            deadline_at,
            funcoes,
            prioridade,
            workflow_stages, // NEW: Optional workflow stages for macro/micro tasks
            drive_link
        } = await req.json()

        console.log('Received payload:', { empresa_id, titulo, descricao, deadline_at, funcoes, prioridade, workflow_stages })

        // Validation
        if (!empresa_id || !titulo || !deadline_at) {
            console.error('Validation failed:', { empresa_id: !!empresa_id, titulo: !!titulo, deadline_at: !!deadline_at })
            return new Response(
                JSON.stringify({ error: 'Missing required fields: empresa_id, titulo, deadline_at' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Validate and normalize priority
        const validPriorities = ['baixa', 'normal', 'alta', 'urgente']
        const normalizedPriority = prioridade && validPriorities.includes(prioridade) ? prioridade : 'normal'

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // NEW WORKFLOW: Macro/Micro Tasks
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        if (workflow_stages && Array.isArray(workflow_stages) && workflow_stages.length > 0) {
            // Create macro task
            const { data: macroTask, error: macroError } = await supabaseClient
                .from('tarefas')
                .insert({
                    titulo,
                    descricao: descricao || null,
                    empresa_id: empresa_id,
                    deadline: deadline_at,
                    status: 'pendente',
                    prioridade: normalizedPriority,
                    progress: 0,
                    drive_link: drive_link || null
                })
                .select()
                .single()

            if (macroError) {
                console.error('Error creating macro task:', macroError)
                return new Response(
                    JSON.stringify({ error: 'Erro ao criar tarefa macro', details: macroError.message }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Create micro tasks with dependencies
            const microTasksToCreate = []
            const microTaskMap = new Map() // ordem -> micro_task_id

            for (let i = 0; i < workflow_stages.length; i++) {
                const stage = workflow_stages[i]
                const ordem = i + 1

                // Determine initial status
                let initialStatus = 'pendente'
                if (stage.depends_on_ordem && stage.depends_on_ordem > 0) {
                    initialStatus = 'bloqueada' // Blocked by dependency
                }

                const microTaskPayload = {
                    tarefa_id: macroTask.id,
                    profissional_id: stage.profissional_id,
                    funcao: stage.funcao,
                    peso: 1, // Default weight since we removed it from UI
                    status: initialStatus,
                    depends_on: null // Will be set after creation
                }

                const { data: microTask, error: microError } = await supabaseClient
                    .from('tarefas_micro')
                    .insert(microTaskPayload)
                    .select()
                    .single()

                if (microError) {
                    console.error(`Error creating micro task for ${stage.funcao}:`, microError)
                    continue
                }

                microTaskMap.set(ordem, microTask.id)

                // Update dependency if exists
                if (stage.depends_on_ordem && stage.depends_on_ordem > 0) {
                    const dependsOnId = microTaskMap.get(stage.depends_on_ordem)
                    if (dependsOnId) {
                        await supabaseClient
                            .from('tarefas_micro')
                            .update({ depends_on: dependsOnId })
                            .eq('id', microTask.id)
                    }
                }

                microTasksToCreate.push(microTask)

                // Log creation
                await supabaseClient
                    .from('tarefas_micro_logs')
                    .insert({
                        tarefa_micro_id: microTask.id,
                        to_profissional_id: stage.profissional_id,
                        acao: 'created'
                    })

                // Notify professional if not blocked
                if (initialStatus === 'pendente') {
                    await supabaseClient
                        .from('notifications')
                        .insert({
                            profissional_id: stage.profissional_id,
                            title: 'Nova Etapa Atribuída',
                            message: `Você recebeu uma nova etapa de ${stage.funcao}: "${titulo}"`,
                            type: 'micro_task_assigned',
                            link: `/staff/tasks`,
                            read: false
                        })
                }
            }

            return new Response(
                JSON.stringify({
                    success: true,
                    mode: 'macro_micro',
                    macro_task_id: macroTask.id,
                    micro_tasks_created: microTasksToCreate.length,
                    micro_tasks: microTasksToCreate.map(mt => ({
                        id: mt.id,
                        funcao: mt.funcao,
                        status: mt.status
                    }))
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // LEGACY WORKFLOW: Individual Tasks (Backward Compatibility)
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        if (!funcoes || !Array.isArray(funcoes) || funcoes.length === 0) {
            return new Response(
                JSON.stringify({ error: 'Missing required field: funcoes (for legacy mode)' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Resolve professionals for ALL selected functions
        const { data: professionals, error: profError } = await supabaseClient
            .from('empresa_profissionais')
            .select(`
                profissional_id,
                funcao,
                profissionais!inner (
                    id,
                    nome,
                    departamento_id
                )
            `)
            .eq('empresa_id', empresa_id)
            .in('funcao', funcoes)
            .eq('ativo', true)

        if (profError) {
            console.error('Error fetching professionals:', profError)
            return new Response(
                JSON.stringify({ error: 'Erro ao buscar profissionais vinculados', details: profError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!professionals || professionals.length === 0) {
            return new Response(
                JSON.stringify({
                    error: 'Nenhum profissional ativo encontrado para as funções selecionadas nesta empresa.',
                    empresa_id,
                    funcoes
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Create tasks for each professional
        const createdTasks = []
        const notifications = []

        for (const prof of professionals) {
            const professional = prof.profissionais

            if (!professional) continue

            // Create task
            const taskPayload = {
                titulo: `${titulo} - ${prof.funcao}`,
                descricao: descricao || null,
                empresa_id: empresa_id,
                assigned_to: professional.id,
                departamento_id: professional.departamento_id,
                deadline: deadline_at,
                status: 'pendente',
                prioridade: normalizedPriority,
                drive_link: drive_link || null
            }

            const { data: task, error: taskError } = await supabaseClient
                .from('tarefas')
                .insert(taskPayload)
                .select()
                .single()

            if (taskError) {
                console.error(`Error creating task for ${professional.nome}:`, taskError)
                continue
            }

            createdTasks.push(task)

            // Create in-app notification
            const notificationPayload = {
                profissional_id: professional.id,
                title: 'Nova Tarefa Atribuída',
                message: `Você recebeu uma nova tarefa de ${prof.funcao}: "${titulo}"`,
                type: 'task_assigned',
                link: `/staff/tasks/${task.id}`,
                read: false
            }

            const { error: notifError } = await supabaseClient
                .from('notifications')
                .insert(notificationPayload)

            if (!notifError) {
                notifications.push(professional.id)
            }
        }

        if (createdTasks.length === 0) {
            return new Response(
                JSON.stringify({
                    error: 'Nenhuma tarefa foi criada. Verifique se há profissionais vinculados às funções selecionadas.',
                    professionals_found: professionals.length
                }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({
                success: true,
                mode: 'legacy',
                tasks_created: createdTasks.length,
                notifications_sent: notifications.length,
                tasks: createdTasks.map(t => ({
                    id: t.id,
                    titulo: t.titulo,
                    profissional_id: t.profissional_id
                }))
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Unexpected error:', error)
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
