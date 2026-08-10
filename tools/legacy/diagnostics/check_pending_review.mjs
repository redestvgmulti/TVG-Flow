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

async function check() {
    const { data, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id, titulo, status, headline, created_at, render_url, url_original, media_status, processing_started_at')
        .eq('status', 'pending_review')
        .order('created_at', { ascending: false })
        .limit(100)

    console.log('Items in Pending Review:')
    console.log(JSON.stringify(data, null, 2))
    if (error) console.error(error)
}

check()
