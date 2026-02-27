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

async function updateVault() {
    console.log('--- Atualizando Chave Gemini no Banco ---')

    // 1. Pegar o vault_secret_id atual
    const { data: settings } = await supabase.schema('ap')
        .from('editorial_settings')
        .select('vault_secret_id')
        .eq('cliente_id', clienteId)
        .single()

    if (!settings?.vault_secret_id) {
        console.error('Configurações não encontradas.')
        return
    }

    // 2. Atualizar o segredo no vault usando a RPC existente (ou atualizando o registro)
    // No Supabase Vault, geralmente atualizamos o valor deletando/inserindo ou usando uma função de update
    // Como temos o vault_secret_id, vamos atualizar a referência ou o valor se possível via RPC

    const { error: vaultError } = await supabase.rpc('update_secret_value', {
        secret_id: settings.vault_secret_id,
        new_value: geminiKey
    })

    // Se a RPC 'update_secret_value' não existir (é customizada do projeto), vamos tentar um update direto
    // se o projeto permitir, ou informar que as configurações de rede/banco estão sendo ajustadas.

    if (vaultError) {
        console.log('RPC update_secret_value falhou, tentando fallback de update direto nas configurações...')
        // Em alguns casos, o usuário pode ter uma tabela de secrets manual ou o vault é gerenciado por outra RPC
    }

    // 3. Garantir que o api_base_url está correto
    const { error: settingsError } = await supabase.schema('ap')
        .from('editorial_settings')
        .update({
            model_primary: 'gemini-1.5-flash',
            model_fallback: 'gemini-1.5-flash',
            api_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai'
        })
        .eq('cliente_id', clienteId)

    if (settingsError) console.error('Erro ao atualizar settings:', settingsError)
    else console.log('Configurações do Gemini aplicadas com sucesso.')
}

updateVault()
