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

async function tryClaudeModels() {
    const models = [
        'gemini-1.5-flash',
        'gemini-pro',
        'gemini-1.5-pro'
    ]

    for (const model of models) {
        console.log(`\n--- Testing Gemini Model: ${model} ---`)
        await supabase.schema('ap')
            .from('editorial_settings')
            .update({
                model_primary: model,
                model_fallback: model,
                api_base_url: 'https://generativelanguage.googleapis.com'
            })
            .eq('cliente_id', clienteId)

        const { data } = await supabase.functions.invoke('ap-content-production', {
            body: { action: 'process_selected' }
        })

        if (data?.processed > 0 && (!data.errors || data.errors.length === 0)) {
            console.log(`SUCCESS with model ${model}!`)
            break
        } else if (data?.errors?.[0]) {
            console.log(`Error with ${model}: ${data.errors[0].error}`)
        }
    }
}

tryClaudeModels()
