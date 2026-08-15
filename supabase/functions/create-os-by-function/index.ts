import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Cargo values that are not valid for real microtask assignment
const INVALID_CARGOS = new Set(['SEM_CARGO', 'LEGADO'])

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const authorization = req.headers.get('Authorization')
        const accessToken = authorization?.replace(/^Bearer\s+/i, '')

        if (!accessToken) {
            return new Response(
                JSON.stringify({ error: 'Authentication required' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: authData, error: authError } = await supabaseClient.auth.getUser(accessToken)
        const authenticatedUserId = authData?.user?.id

        if (authError || !authenticatedUserId) {
            return new Response(
                JSON.stringify({ error: 'Invalid authentication' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const {
            empresa_id: empresa_id_from_client,
            cliente_id,
            titulo,
            descricao,
            deadline_at,
            funcoes,
            profissionais_ids,
            prioridade,
            workflow_stages,
            drive_link,
            created_by: requestedCreatedBy
        } = await req.json()

        if (requestedCreatedBy && requestedCreatedBy !== authenticatedUserId) {
            return new Response(
                JSON.stringify({ error: 'Creator does not match the authenticated user' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const created_by = authenticatedUserId

        console.log('Received payload:', { empresa_id_from_client, titulo, workflow_stages: workflow_stages?.length, created_by })

        // ──────────────────────────────────────────────────────────────
        // VALIDATION: required fields
        // ──────────────────────────────────────────────────────────────
        if (!empresa_id_from_client || !titulo || !deadline_at) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: empresa_id, titulo, deadline_at' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ──────────────────────────────────────────────────────────────
        // SECURITY: Resolve user profile
        // ──────────────────────────────────────────────────────────────
        const { data: userProfile, error: profileError } = await supabaseClient
            .from('profissionais')
            .select('role')
            .eq('id', created_by)
            .single()

        if (profileError || !userProfile) {
            return new Response(
                JSON.stringify({ error: 'Usuário não encontrado' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ──────────────────────────────────────────────────────────────
        // SECURITY: Derive empresa_id from backend — never trust client
        // Prevents privilege escalation via crafted empresa_id values
        // ──────────────────────────────────────────────────────────────
        let empresa_id: string

        if (userProfile.role === 'admin') {
            // Admin: confirm empresa exists in DB, use it as-is
            const { data: empresaExists } = await supabaseClient
                .from('empresas')
                .select('id')
                .eq('id', empresa_id_from_client)
                .single()

            if (!empresaExists) {
                return new Response(
                    JSON.stringify({ error: 'Empresa não encontrada' }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            empresa_id = empresaExists.id
        } else {
            // Non-admin: empresa_id must be derived from their own empresa_profissionais record
            const { data: epLink, error: epLinkError } = await supabaseClient
                .from('empresa_profissionais')
                .select('empresa_id')
                .eq('profissional_id', created_by)
                .eq('empresa_id', empresa_id_from_client)
                .eq('ativo', true)
                .maybeSingle()

            if (epLinkError || !epLink) {
                console.error('Permission denied: user not linked to company', { created_by, empresa_id_from_client })
                return new Response(
                    JSON.stringify({ error: 'Você não tem permissão para criar tarefas nesta empresa' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            // Use empresa_id from DB record — not from client
            empresa_id = epLink.empresa_id
        }

        // ──────────────────────────────────────────────────────────────
        // SAFE DEFAULTS — never trust frontend for these
        // ──────────────────────────────────────────────────────────────
        const validPriorities = ['baixa', 'normal', 'alta', 'urgente']
        const normalizedPriority = prioridade && validPriorities.includes(prioridade) ? prioridade : 'normal'
        const safeStatus = 'pendente'

        // ══════════════════════════════════════════════════════════════
        // WORKFLOW: Macro/Micro Tasks
        // ══════════════════════════════════════════════════════════════
        if (workflow_stages && Array.isArray(workflow_stages) && workflow_stages.length > 0) {

            // ──────────────────────────────────────────────────────────
            // PERFORMANCE: Batch-fetch ALL cargos in a single query.
            // Build a Map(profissional_id → cargo) to use inside the loop.
            // Never query the DB inside the loop.
            // ──────────────────────────────────────────────────────────
            const allProfissionalIds = [
                ...new Set(
                    (workflow_stages as any[])
                        .map((s: any) => s.profissional_id)
                        .filter(Boolean)
                )
            ]

            const { data: cargoRows, error: cargoError } = await supabaseClient
                .from('empresa_profissionais')
                .select('profissional_id, cargo')
                .eq('empresa_id', empresa_id)
                .in('profissional_id', allProfissionalIds)

            if (cargoError) {
                console.error('Error fetching cargos batch:', cargoError)
                return new Response(
                    JSON.stringify({ error: 'Erro ao buscar cargos dos profissionais', details: cargoError.message }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Build in-memory map: profissional_id → cargo (null if invalid)
            const cargoMap = new Map<string, string | null>()
            for (const row of cargoRows ?? []) {
                const valid = row.cargo && !INVALID_CARGOS.has(row.cargo) ? row.cargo : null
                cargoMap.set(row.profissional_id, valid)
            }

            console.log('Cargo map built:', Object.fromEntries(cargoMap))

            // Create macro task
            const { data: macroTask, error: macroError } = await supabaseClient
                .from('tarefas')
                .insert({
                    titulo,
                    descricao: descricao || null,
                    empresa_id,
                    cliente_id: cliente_id || null,
                    created_by,
                    deadline: deadline_at,
                    status: safeStatus,
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

            const microTasksCreated: any[] = []
            const skipped: any[] = []
            const microTaskMap = new Map<number, string>() // ordem → micro_task_id

            for (let i = 0; i < (workflow_stages as any[]).length; i++) {
                const stage = (workflow_stages as any[])[i]
                const ordem = i + 1

                // ──────────────────────────────────────────────────────
                // HARDENING: Validate cargo from in-memory map.
                // cargo is the ONLY source of truth.
                // funcao is legacy display only — never used for logic.
                // ──────────────────────────────────────────────────────
                const cargoSnapshot = cargoMap.get(stage.profissional_id) ?? null

                if (!cargoSnapshot) {
                    console.warn(`Profissional ${stage.profissional_id} sem cargo válido — microtask bloqueada`)
                    skipped.push({
                        profissional_id: stage.profissional_id,
                        funcao_recebida: stage.funcao ?? null,
                        motivo: 'cargo_invalido'
                    })
                    continue
                }

                const initialStatus = stage.depends_on_ordem && stage.depends_on_ordem > 0
                    ? 'bloqueada'
                    : 'pendente'

                const { data: microTask, error: microError } = await supabaseClient
                    .from('tarefas_micro')
                    .insert({
                        tarefa_id: macroTask.id,
                        profissional_id: stage.profissional_id,
                        cargo: cargoSnapshot,          // ← immutable snapshot, source of truth
                        funcao: stage.funcao ?? null,  // ← legacy only, visual compatibility
                        peso: 1,
                        status: initialStatus,
                        depends_on: null,
                        deadline_at: stage.deadline_at || null
                    })
                    .select()
                    .single()

                if (microError) {
                    console.error('Error creating micro task:', microError)
                    skipped.push({
                        profissional_id: stage.profissional_id,
                        funcao_recebida: stage.funcao ?? null,
                        motivo: 'db_error',
                        details: microError.message
                    })
                    continue
                }

                microTaskMap.set(ordem, microTask.id)

                // Resolve dependency link
                if (stage.depends_on_ordem && stage.depends_on_ordem > 0) {
                    const dependsOnId = microTaskMap.get(stage.depends_on_ordem)
                    if (dependsOnId) {
                        await supabaseClient
                            .from('tarefas_micro')
                            .update({ depends_on: dependsOnId })
                            .eq('id', microTask.id)
                    }
                }

                microTasksCreated.push(microTask)

                // Creation log
                await supabaseClient
                    .from('tarefas_micro_logs')
                    .insert({
                        tarefa_micro_id: microTask.id,
                        to_profissional_id: stage.profissional_id,
                        acao: 'created'
                    })

                // Notify using cargo — never funcao
                if (initialStatus === 'pendente') {
                    await supabaseClient
                        .from('notifications')
                        .insert({
                            profissional_id: stage.profissional_id,
                            title: 'Nova Etapa Atribuída',
                            message: `Você recebeu uma nova etapa de ${cargoSnapshot}: "${titulo}"`,
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
                    micro_tasks_created: microTasksCreated.length,
                    skipped,
                    micro_tasks: microTasksCreated.map(mt => ({
                        id: mt.id,
                        cargo: mt.cargo,
                        funcao: mt.funcao,
                        status: mt.status
                    }))
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ══════════════════════════════════════════════════════════════
        // LEGACY WORKFLOW: Individual Tasks (OS Simples)
        // ══════════════════════════════════════════════════════════════
        const funcoesArr = (funcoes || []) as string[]
        const profissionaisIdsArr = (profissionais_ids || []) as string[]

        if (funcoesArr.length === 0 && profissionaisIdsArr.length === 0) {
            return new Response(
                JSON.stringify({ error: 'Missing required field: funcoes or profissionais_ids (for OS Simples mode)' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // `cargo` was dropped from this table's real schema (added by the
        // 2026-03-18 role/cargo migration series, never applied here) — see
        // the same fix in src/components/forms/TaskForm.jsx. `funcao` is the
        // NOT NULL column every other query in this codebase already reads.
        let query = supabaseClient
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
            .eq('ativo', true)

        if (profissionaisIdsArr.length > 0) {
            query = query.in('profissional_id', profissionaisIdsArr)
        } else {
            query = query.in('funcao', funcoesArr) // Fallback for older interface
        }

        const { data: professionals, error: profError } = await query
        if (profError) {
            return new Response(
                JSON.stringify({ error: 'Erro ao buscar profissionais vinculados', details: profError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!professionals || professionals.length === 0) {
            return new Response(
                JSON.stringify({
                    error: 'Nenhum profissional ativo encontrado para a seleção nesta empresa.',
                    empresa_id,
                    funcoes: funcoesArr,
                    profissionais_ids: profissionaisIdsArr
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const createdTasks: any[] = []
        const notifications: string[] = []

        for (const prof of professionals) {
            const professional = (prof as any).profissionais
            if (!professional) continue

            const { data: task, error: taskError } = await supabaseClient
                .from('tarefas')
                .insert({
                    titulo: `${titulo} - ${prof.cargo || prof.funcao}`,
                    descricao: descricao || null,
                    empresa_id,
                    cliente_id: cliente_id || null,
                    created_by,
                    assigned_to: professional.id,
                    departamento_id: professional.departamento_id,
                    deadline: deadline_at,
                    status: safeStatus,
                    prioridade: normalizedPriority,
                    drive_link: drive_link || null
                })
                .select()
                .single()

            if (taskError) {
                console.error(`Error creating task for ${professional.nome}:`, taskError)
                continue
            }

            createdTasks.push(task)

            await supabaseClient
                .from('notifications')
                .insert({
                    profissional_id: professional.id,
                    title: 'Nova Tarefa Atribuída',
                    message: `Você recebeu uma nova tarefa de ${prof.cargo || prof.funcao}: "${titulo}"`,
                    type: 'task_assigned',
                    link: `/staff/tasks/${task.id}`,
                    read: false
                })

            notifications.push(professional.id)
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
                tasks: createdTasks.map(t => ({ id: t.id, titulo: t.titulo }))
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Unexpected error:', error)
        return new Response(
            JSON.stringify({ error: (error as Error).message || 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
