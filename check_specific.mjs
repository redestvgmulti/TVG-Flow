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
        .select('*')
        .eq('id', 'cd451194-e094-46f4-8a47-a379f64a4ed4')
        .single();
        
    console.log('Specific Item cd451194:');
    console.log(JSON.stringify(data, null, 2));
    if (error) console.error(error);
}

check()
