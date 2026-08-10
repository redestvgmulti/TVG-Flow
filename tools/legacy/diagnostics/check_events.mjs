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
    // We'll try to query the information_schema via a view or just a clever query if possible.
    // Since we can't use execute_sql tool easily, we'll try to use the supabase client to query a non-registered table.
    // Actually, supabase JS client can't query information_schema directly unless it's exposed.
    
    // Let's try to query the logs of the specific stuck item more aggressively.
    const stuckId = 'cd451194-e094-46f4-8a47-a379f64a4ed4';
    
    // Check editorial_events for this item
    const { data: events, error: evErr } = await supabase
        .schema('ap')
        .from('editorial_events')
        .select('*')
        .eq('news_id', stuckId)
        .order('created_at', { ascending: false });
        
    console.log('Editorial Events for stuck item:');
    console.log(JSON.stringify(events, null, 2));
    if (evErr) console.error(evErr);

    // Also check if we can see the 'processing' status in ANY item right now
    const { data: procItems } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id, titulo, status')
        .eq('status', 'processing');
    
    console.log('Items currently in "processing" status:');
    console.log(JSON.stringify(procItems, null, 2));
}

check()
