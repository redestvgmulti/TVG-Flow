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

// We'll use the anon key as the frontend does, but we won't bypass auth
const functionSupabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

async function debugEdgeFunction() {
    console.log('--- Simulating Edge Function Invoke ---')
    
    const payload = {
        action: 'approve_for_ig',
        newsId: '372d477a-3422-4f2d-abf3-a54d955353ce',
        userHeadline: 'Caixa leiloa imóveis em Goiás a partir de R$ 95 mil',
        userTag: 'Economia', // Guessed
        userText: null, // As from DB
        approved_by_id: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9',
        approved_by_name: 'Antigravity Auditor'
    }

    console.log('Sending payload:', payload)

    const { data, error } = await functionSupabase.functions.invoke('ap-content-production', {
        body: payload
    })

    if (error) {
        console.error('Edge Function Error:', error)
    } else {
        console.log('Edge Function Success:', data)
    }
}

debugEdgeFunction()
