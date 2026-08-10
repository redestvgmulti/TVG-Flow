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

async function findArticle() {
    console.log('--- Searching for Caixa article ---')
    const { data: news, error } = await supabase.schema('ap').from('candidate_news')
        .select('id, titulo, headline, status')
        .or('titulo.ilike.%Caixa%,headline.ilike.%Caixa%')
        .order('created_at', { ascending: false })
        .limit(20)

    if (error) {
        console.error('Error fetching articles:', error)
        return
    }

    console.log('Found Articles:', JSON.stringify(news, null, 2))
}

findArticle()
