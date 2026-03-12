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
    const { data: cols, error: err1 } = await supabase.rpc('get_column_info', { p_table: 'candidate_news', p_schema: 'ap' })
    // If RPC doesn't exist, we try a direct query via a sneaky trick or just move on.
    
    console.log('Column info or any error:')
    if (err1) console.error(err1)
    
    // Check if we can find any errors in ap-render-engine's results field of other items
    const { data: sampleItems, error: err2 } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('*')
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(5)
    
    console.log('Recent failed items:')
    console.log(JSON.stringify(sampleItems, null, 2))
}

check()
