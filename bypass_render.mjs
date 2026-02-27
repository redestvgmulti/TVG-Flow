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

async function moveForReview() {
    console.log('Movendo itens para pending_review manualmente...')
    const { data: items } = await supabase.schema('ap').from('candidate_news')
        .select('id')
        .eq('status', 'pending_render')

    if (!items || items.length === 0) {
        console.log('Nenhum item em pending_render.')
        return
    }

    const { error } = await supabase.schema('ap').from('candidate_news')
        .update({
            status: 'pending_review',
            render_url: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1000&auto=format&fit=crop' // Imagem genérica de notícia
        })
        .in('id', items.map(i => i.id))

    if (error) console.error('Erro:', error)
    else console.log(`${items.length} itens movidos para Revisão Editorial.`)
}

moveForReview()
