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

async function checkEvents() {
    const { data, error } = await supabase
        .from('ap_editorial_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

    if (error) {
        console.error('Error fetching events:', error)
        return
    }

    console.log('Last 5 Editorial Events:')
    console.log(JSON.stringify(data, null, 2))
}

checkEvents()
