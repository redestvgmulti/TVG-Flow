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

async function check() {
    const { data: news, error } = await supabase
        .from('ap_candidate_news')
        .select('*')
        .or('titulo.ilike.%UFG%,headline.ilike.%UFG%')
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log('Search Results for UFG (ALL FIELDS):')
    console.log(JSON.stringify(news, null, 2))
}

check()
