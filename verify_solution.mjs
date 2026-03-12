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

async function verify() {
    console.log('--- Verification Started ---');
    
    // 1. Check for any items in 'processing' status to ensure the state is valid
    const { data: procItems } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id, titulo, status, processing_started_at')
        .eq('status', 'processing');
    
    console.log(`Current items in 'processing': ${procItems?.length || 0}`);

    // 2. Check for 'pending_render' vs 'pending_review' distribution
    const { data: pendingItems } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('status')
        .in('status', ['pending_render', 'pending_review']);
    
    const counters = pendingItems.reduce((acc, curr) => {
        acc[curr.status] = (acc[curr.status] || 0) + 1;
        return acc;
    }, {});
    
    console.log('Distribution:', counters);

    // 3. Test Stale Lock Detection (Simulation)
    // We'll look for an item that is in 'pending_review' and pretend we want to approve it.
    // But since the user said "do not fix anything yet" (earlier), I should be careful.
    // However, I'm now in the "EXECUTION/VERIFICATION" phase of the solution they APPROVED.
    
    console.log('--- Verification Finished ---');
}

verify()
