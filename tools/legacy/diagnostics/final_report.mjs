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
        .select('id, titulo, status, render_url, processing_started_at, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
        
    if (error) {
        console.error(error);
        return;
    }

    const report = {};
    data.forEach(item => {
        if (!report[item.status]) report[item.status] = [];
        report[item.status].push(item);
    });

    console.log('Status Report (Last 200 items):');
    for (const s in report) {
        console.log(`- ${s}: ${report[s].length} items`);
    }
    
    console.log('\nDetails for pending_render/pending_review:');
    const interesting = data.filter(i => i.status === 'pending_render' || i.status === 'pending_review');
    console.log(JSON.stringify(interesting, null, 2));
}

check()
