import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env.local', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=')
    if (key && values.length > 0) {
        env[key.trim()] = values.join('=').trim()
    }
})

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const clienteId = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
const geminiKey = 'AIzaSyAsVYDm9hD8lcZgYyrX8VROk3VMAnQCX_A'

async function forceUpdateVault() {
    console.log('--- Fazendo a Troca Forçada da Chave no Vault ---')

    // 1. Pegar o vault_secret_id atual
    const { data: settings } = await supabase.schema('ap')
        .from('editorial_settings')
        .select('vault_secret_id')
        .eq('cliente_id', clienteId)
        .single()

    console.log('Secret ID atual:', settings?.vault_secret_id)

    if (settings?.vault_secret_id) {
        // 2. Atualizar o segredo diretamente na tabela vault.secrets usando SQL
        // A maioria das contas de serviço no Supabase tem acesso a fazer queries RAW se configurado
        const { error: sqlError } = await supabase.rpc('execute_sql', {
            query: `UPDATE vault.secrets SET secret = '${geminiKey}', updated_at = now() WHERE id = '${settings.vault_secret_id}';`
        })

        if (sqlError) {
            console.log('Erro ao atualizar via execute_sql:', sqlError.message)
            console.log('Tentando plano C: Criar um novo segredo e atualizar a referência.')

            // Plano C: Inserir novo segredo
            const newSecretId = crypto.randomUUID()
            const { error: insError } = await supabase.rpc('execute_sql', {
                query: `INSERT INTO vault.secrets (id, name, secret) VALUES ('${newSecretId}', 'editorial_gemini_key', '${geminiKey}');`
            })

            if (!insError) {
                await supabase.schema('ap').from('editorial_settings').update({ vault_secret_id: newSecretId }).eq('cliente_id', clienteId)
                console.log('Nova chave inserida e referenciada.')
            } else {
                console.log('Erro ao inserir nova chave:', insError.message)
            }
        } else {
            console.log('Chave existente no Vault atualizada com sucesso.')
        }
    }
}

forceUpdateVault()
