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

async function triggerRender() {
    console.log('Invoking ap-render-engine...')
    const { data, error } = await supabase.functions.invoke('ap-render-engine', {
        body: {}
    })

    if (error) console.error('Erro na função:', error)
    else console.log('Resposta:', data)
}

triggerRender()
