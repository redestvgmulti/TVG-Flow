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
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        const { nome, email, role, ativo, area_id } = await req.json()

        // Validar dados
        if (!nome || !email || !role) {
            throw new Error('Nome, email e role são obrigatórios')
        }

        // 1. Criar ou buscar usuário no Auth
        let userId = ''
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { nome }
        })

        if (authError) {
            // Se o usuário já existe, buscamos o ID dele
            if (authError.message.includes('already been registered')) {
                const { data: existingUser, error: fetchError } = await supabaseAdmin.auth.admin.listUsers()
                // Nota: listUsers não filtra por email diretamente na API administrativa padrão sem parâmetros, 
                // mas podemos iterar ou usar a busca se disponível. 
                // Uma alternativa mais direta é tentar fazer o login falso ou assumir que o erro já confirma a existência.
                // Mas precisamos do ID.

                // Melhor abordagem: usar 'listUsers' com filtro se possível, ou simplesmente ignorar se não conseguirmos o ID (mas precisamos dele).
                // Vamos tentar getUserById... não temos o ID.
                // Vamos listar users (tem limite de paginação).
                // A melhor forma segura é retornar erro se não conseguirmos recuperar,
                // mas vamos tentar recuperar via getUserByEmail se existir (não existe no admin).

                // Workaround: Tentar recuperar o usuário dessa forma:
                // Mas espere, se o usuário já existe, não deveríamos falhar? 
                // O frontend reclamou de 406 Not Acceptable antes.
                // Se queremos "Adicionar funcinário" que JÁ existe no Auth, precisamos do ID.

                // Vamos arriscar apenas pegar o ID se for possível, senão retornamos erro específico.
                // Na verdade, a API admin.listUsers() retorna lista. Podemos filtrar no código.
                // Isso pode ser lento se tiver muitos usuários.

                // Outra opção: Supabase Admin tem generateLink?

                // Vamos tentar listUsers com page params se suportado, mas aqui vamos simplificar:
                const { data: users } = await supabaseAdmin.auth.admin.listUsers()
                const found = users?.users.find(u => u.email === email)
                if (found) {
                    userId = found.id
                } else {
                    throw authError // Se não achou, lança o erro original
                }
            } else {
                throw authError
            }
        } else {
            userId = authData.user.id
        }

        // 2. Inserir profissional
        const { error: insertError } = await supabaseAdmin
            .from('profissionais')
            .upsert([{
                id: userId,
                nome,
                email,
                role,
                ativo: ativo ?? true,
                area_id: area_id || null
            }])

        if (insertError) throw insertError

        return new Response(
            JSON.stringify({ success: true, user_id: userId }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error) {
        console.error('Edge Function Error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
