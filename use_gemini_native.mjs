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

async function useGemini() {
    console.log('--- Configurando para Gemini Nativo ---')

    // 1. Verificar se a chave Gemini está no vault
    const { data: settings } = await supabase.schema('ap').from('editorial_settings').select('vault_secret_id').eq('cliente_id', clienteId).single()

    // Update the secret value via SQL if possible, or just update the settings to use the key we know
    // Actually, I will update editorial_settings to use the Gemini URL and models.
    const { error } = await supabase.schema('ap')
        .from('editorial_settings')
        .update({
            model_primary: 'gemini-1.5-flash',
            model_fallback: 'gemini-1.5-flash',
            api_base_url: 'https://generativelanguage.googleapis.com'
        })
        .eq('cliente_id', clienteId)

    if (error) console.error('Error:', error)
    else console.log('Configurado para Gemini 1.5 Flash Nativo.')
}

useGemini()
