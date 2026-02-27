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

// NEED TO USE SERVICE_ROLE KEY TO BYPASS RLS IF ANY, but ANON is fine for functions usually, 
// though edge functions might need auth. We'll use service_role.
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY)

async function trigger() {
    console.log('Invoking ap-content-production for news f74444d1-c294-4641-8263-374204014125')
    const { data, error } = await supabase.functions.invoke('ap-content-production', {
        body: {
            action: 'process_selected',
            newsId: 'f74444d1-c294-4641-8263-374204014125'
        }
    })

    console.log('Response:')
    console.log(data)
    if (error) console.error('Error:', error)
}

trigger()
