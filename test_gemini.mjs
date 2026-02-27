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

async function testGemini() {
    const { data: settings } = await supabase.schema('ap').from('editorial_settings').select('vault_secret_id').eq('cliente_id', 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9').single()
    const { data: apiKey } = await supabase.rpc('get_decrypted_secret', { secret_id: settings.vault_secret_id })

    const key = apiKey.trim()
    console.log('Testing Gemini OpenAI Shim with key prefix:', key.substring(0, 10))

    // Test with Bearer Auth
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model: 'gemini-1.5-flash',
            messages: [{ role: 'user', content: 'Hello' }]
        })
    })

    const data = await res.json()
    console.log('Gemini Response Status:', res.status)
    console.log('Gemini Response:', JSON.stringify(data, null, 2))
}

testGemini()
