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
    const { data: clients, error } = await supabase
        .from('empresas')
        .select('id, nome')
    
    if (error) {
        console.error('Error fetching empresas:', error)
    } else {
        console.log('Empresas:', clients)
    }

    const { data: news, error: newsError } = await supabase
        .from('ap_candidate_news')
        .select('id, titulo, status, headline, empresa_id')
        .or('titulo.ilike.%UFG%,headline.ilike.%UFG%')

    if (newsError) {
        console.error('Error fetching news:', newsError)
    } else {
        console.log('UFG News with empresa_id:', news)
    }
}

check()
