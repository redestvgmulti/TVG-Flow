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
        .ilike('titulo', '%ALERTA DE PERIGO%')
        .limit(10);
        
    console.log('Results for ALERTA DE PERIGO:');
    console.log(JSON.stringify(data, null, 2));
}

check()
