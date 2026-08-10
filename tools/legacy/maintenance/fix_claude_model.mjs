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

async function fixModel() {
    console.log('--- Corrigindo Nome do Modelo Claude ---')
    const { error } = await supabase.schema('ap')
        .from('editorial_settings')
        .update({
            model_primary: 'claude-3-7-sonnet-20250219',
            model_fallback: 'claude-3-5-sonnet-20241022',
            api_base_url: 'https://api.anthropic.com/v1/messages'
        })
        .eq('cliente_id', clienteId)

    if (error) console.error('Erro:', error)
    else console.log('Modelo corrigido para claude-3-7-sonnet-20250219')
}

fixModel()
