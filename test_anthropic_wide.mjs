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

async function testAnthropic() {
    const { data: settings } = await supabase.schema('ap').from('editorial_settings').select('vault_secret_id').eq('cliente_id', clienteId).single()
    const { data: apiKey } = await supabase.rpc('get_decrypted_secret', { secret_id: settings.vault_secret_id })

    const key = apiKey.trim()
    console.log('Testing Anthropic with key prefix:', key.substring(0, 15))

    const models = [
        'claude-3-5-sonnet-latest',
        'claude-3-5-sonnet-20240620',
        'claude-3-haiku-20240307',
        'claude-2.1',
        'claude-instant-1.2'
    ]

    for (const model of models) {
        console.log(`\n--- Testing Model: ${model} ---`)
        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: model,
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'Ping' }]
                })
            })

            const data = await res.json()
            console.log('Status:', res.status)
            if (res.ok) {
                console.log('Success! Response:', data.content[0].text)
                return // Stop if we find one
            } else {
                console.log('Error Type:', data.error?.type)
                console.log('Error Msg:', data.error?.message)
            }
        } catch (err) {
            console.log('Fetch Error:', err.message)
        }
    }
}

testAnthropic()
