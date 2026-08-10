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

async function update() {
    const { error } = await supabase.schema('ap')
        .from('editorial_settings')
        .update({
            model_primary: 'gpt-4o-mini',
            model_fallback: 'gpt-4o-mini',
            api_base_url: 'https://api.openai.com/v1'
        })
        .eq('cliente_id', 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9')

    if (error) console.error(error)
    else console.log('Model updated to gpt-4o-mini and URL fixed')
}

update()
