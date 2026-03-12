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

async function getPending() {
    console.log('--- Fetching all pending items ---')
    const { data: news, error } = await supabase.schema('ap').from('candidate_news')
        .select('id, titulo, headline, status')
        .in('status', ['selected', 'pending_review', 'studio_selected', 'studio_ready'])
        .order('created_at', { ascending: false })
        .limit(10)

    if (error) {
        console.error('Error fetching articles:', error)
        return
    }

    console.log('Found Pending Articles:', JSON.stringify(news, null, 2))
}

getPending()
