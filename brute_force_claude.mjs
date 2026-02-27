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
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-haiku-20241022',
        'claude-3-haiku-20240307'
    ]

    for (const model of models) {
        console.log(`\n--- Testing Global Model Update to: ${model} ---`)
        await supabase.schema('ap')
            .from('editorial_settings')
            .update({
                model_primary: model,
                model_fallback: model,
                api_base_url: 'https://api.anthropic.com/v1/messages'
            })
            .eq('cliente_id', clienteId)

        const { data } = await supabase.functions.invoke('ap-content-production', {
            body: { action: 'process_selected' }
        })

        const hasSuccess = data?.processed > 0 && (!data.errors || data.errors.length === 0)
        console.log(`Result: ${data?.processed} processed. Errors: ${data?.errors?.length || 0}`)

        if (data?.errors?.[0]) {
            console.log(`Sample Error: ${data.errors[0].error}`)
        }

        if (hasSuccess) {
            console.log(`SUCCESS with model ${model}!`)
            break
        }
    }
}

tryClaudeModels()
