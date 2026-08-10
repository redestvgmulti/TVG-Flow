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

async function fixGeminiModel() {
    console.log('--- Corrigindo Nome do Modelo Gemini para Nativo ---')
    const { error } = await supabase.schema('ap')
        .from('editorial_settings')
        .update({
            model_primary: 'gemini-1.5-flash-001',
            model_fallback: 'gemini-1.5-flash-8b-latest',
            api_base_url: 'https://generativelanguage.googleapis.com'
        })
        .eq('cliente_id', clienteId)

    if (error) console.error('Erro:', error)
    else console.log('Modelo corrigido para gemini-1.5-flash-001')
}

fixGeminiModel()
