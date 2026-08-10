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

async function findArticle() {
    console.log('--- Step 1: Finding the Caixa article ---')
    const { data: news, error } = await supabase.schema('ap').from('candidate_news')
        .select('*')
        .ilike('titulo', '%Caixa leiloa%')
        .order('created_at', { ascending: false })
        .limit(1)

    if (error) {
        console.error('Error fetching article:', error)
        return
    }

    if (!news || news.length === 0) {
        console.error('No article found.')
        return
    }

    const item = news[0]
    console.log('Found Article:', item.id, item.titulo, 'Status:', item.status)

    console.log('--- Step 2: Simulating edge function invoke payload ---')
    
    // The payload exactly as sent by AutoPublisher.jsx
    const payload = {
        action: 'approve_for_ig',
        newsId: item.id,
        userHeadline: item.headline || null,
        userTag: item.context_tag || null,
        userText: item.caption || null,
        approved_by_id: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9', // Mock
        approved_by_name: 'Antigravity Auditor'
    }

    console.log('Payload:', payload)

    console.log('--- Step 3: Direct invoke tests ---')
    // We will use anon key to test the actual invoke, just as the client does,
    // assuming we don't need auth bypass if the function verifies JWT: false
    const functionSupabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
    const { data, error: fnError } = await functionSupabase.functions.invoke('ap-content-production', {
        body: payload
    })

    if (fnError) {
        console.error('Edge Function Error:', fnError)
    } else {
        console.log('Edge Function Success:', data)
    }
}

findArticle()
