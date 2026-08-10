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
    console.log('--- Verificando Prefixo da Chave no Vault ---')

    const { data: settings } = await supabase.schema('ap')
        .from('editorial_settings')
        .select('vault_secret_id')
        .eq('cliente_id', clienteId)
        .single()

    const { data: decrypted } = await supabase.rpc('get_decrypted_secret', { secret_id: settings.vault_secret_id })
    console.log('Decrypted Key Prefix:', decrypted?.substring(0, 10))

    if (decrypted?.startsWith('sk-ant')) {
        console.log('CHAVE ANTIGA DETECTADA! Forçando atualização via RPC se disponível...')
        // Tentativa de update_editorial_secret ou similar se o projeto tiver
        const { error: updErr } = await supabase.rpc('update_editorial_secret', {
            p_cliente_id: clienteId,
            p_secret_value: geminiKey
        })
        if (updErr) console.log('Erro na RPC personalizada:', updErr.message)
        else console.log('Chave atualizada com sucesso via RPC personalizada.')
    }
}

updateVault()
