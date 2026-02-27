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

async function testAnthropic() {
    const { data: settings } = await supabase.schema('ap').from('editorial_settings').select('vault_secret_id').eq('cliente_id', 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9').single()

    if (!settings?.vault_secret_id) {
        console.error('No secret ID found')
        return
    }

    const { data: apiKey } = await supabase.rpc('get_decrypted_secret', { secret_id: settings.vault_secret_id })

    if (!apiKey) {
        console.error('Failed to decrypt API Key')
        return
    }

    const models = ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-latest', 'claude-3-haiku-20240307'];

    for (const model of models) {
        console.log(`--- Testing model: ${model} ---`);
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey.trim(),
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model,
                max_tokens: 10,
                messages: [{ role: 'user', content: 'Hello' }]
            })
        });

        const data = await res.json();
        console.log(`Status: ${res.status}`);
        console.log(`Response: ${JSON.stringify(data, null, 2)}`);
    }
}

testAnthropic()
