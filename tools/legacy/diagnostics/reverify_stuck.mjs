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
        .select('id, titulo, status, processing_started_at, render_url')
        .or('status.eq.pending_render,status.eq.pending_review')
        .order('created_at', { ascending: false })
        .limit(20);
        
    console.log('Stuck candidates:');
    console.log(JSON.stringify(data, null, 2));
}

check()
