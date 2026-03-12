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
const adminSupabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function verifyFix() {
    console.log('--- Verifying Edge Function Invoke ---')
    const start = Date.now()
    
    const payload = {
        action: 'approve_for_ig',
        newsId: '372d477a-3422-4f2d-abf3-a54d955353ce', // Caixa
        userHeadline: 'Caixa leiloa imóveis em Goiás com desconto',
        userTag: 'ECONOMIA',
        userText: 'Caixa faz mais um leilão de imóveis',
        approved_by_id: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9',
        approved_by_name: 'Antigravity Auditor'
    }

    console.log('Sending payload:', payload)

    const { data, error } = await adminSupabase.functions.invoke('ap-content-production', {
        body: payload,
        headers: {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        }
    })

    const duration = Date.now() - start
    console.log(`Duration: ${duration}ms`)

    if (error) {
        console.error('Edge Function Error:', error)
    } else {
        console.log('Edge Function Success:', JSON.stringify(data, null, 2))
    }

    console.log('--- Checking DB Status ---')
    const { data: news } = await adminSupabase.schema('ap').from('candidate_news')
        .select('id, status, headline')
        .eq('id', '372d477a-3422-4f2d-abf3-a54d955353ce')
        .single()
        
    console.log('DB State:', news)
}

verifyFix()
