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
    // We'll try to guess the enum type name or find it via information_schema if we can.
    // Since we can't run raw SQL easily, we'll try to use a dummy update to see the error message.
    
    const stuckId = 'cd451194-e094-46f4-8a47-a379f64a4ed4';
    const { data, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .update({ status: 'processing' })
        .eq('id', stuckId)
        .select();
        
    console.log('Attempted update to status "processing":');
    if (error) {
        console.log('ERROR (Expected if invalid):', error.message);
        console.log('ERROR Details:', JSON.stringify(error, null, 2));
    } else {
        console.log('SUCCESS! Updated to processing.', data);
    }
}

check()
