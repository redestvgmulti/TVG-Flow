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

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

async function checkSchema() {
    const { data, error } = await supabase
        .from('ap_candidate_news')
        .select('*')
        .limit(1)

    if (error) {
        console.error('Error fetching data:', error)
        return
    }

    if (data && data.length > 0) {
        console.log('Columns in ap_candidate_news:')
        console.log(Object.keys(data[0]))
    } else {
        console.log('No data found in ap_candidate_news')
    }
}

checkSchema()
