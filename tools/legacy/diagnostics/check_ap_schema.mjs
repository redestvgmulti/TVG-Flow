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
    // Check in schema 'ap' and table 'candidate_news'
    const { data, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log('Last 10 items from ap.candidate_news:')
    data.forEach(item => {
        console.log(`- ID: ${item.id}, Status: ${item.status}, Headline: ${item.headline || item.titulo}`)
    })
}

check()
