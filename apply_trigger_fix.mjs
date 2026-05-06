const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function forceCreateUser() {
    const email = 'lorranegontijo@tvgflow.com'
    const nome = 'Lorrane Gontijo'

    console.log(`🚀 Iniciando criação forçada de: ${email}`)

    // 1. Tentar criar o usuário no Auth Admin
    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email: email,
            email_confirm: true,
            user_metadata: { nome: nome },
            password: 'Password123!' // Senha temporária
        })
    })

    const authData = await authRes.json()

    if (!authRes.ok) {
        console.error('❌ Erro no Auth Admin:', JSON.stringify(authData))
        if (authData.msg?.includes('Database error')) {
            console.log('💡 Dica: O gatilho (trigger) no seu banco de dados ainda está quebrado.')
        }
        return
    }

    const userId = authData.id
    console.log('✅ Usuário criado no Auth com ID:', userId)

    // 2. Inserir manualmente na tabela profissionais (caso o trigger tenha falhado silenciosamente ou esteja vazio)
    const profRes = await fetch(`${supabaseUrl}/rest/v1/profissionais`, {
        method: 'POST',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            id: userId,
            nome: nome,
            email: email,
            role: 'staff',
            ativo: true
        })
    })

    const profData = await profRes.json()

    if (!profRes.ok) {
        console.error('❌ Erro ao criar perfil na tabela profissionais:', JSON.stringify(profData))
    } else {
        console.log('✅ Perfil criado com sucesso na tabela profissionais!')
    }
    
    console.log('\n🎉 Processo concluído. Se ambos deram verde, a Lorrane já pode logar.')
}

forceCreateUser()
