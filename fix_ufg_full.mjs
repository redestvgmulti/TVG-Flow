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

async function update() {
    const { data, error } = await supabase
        .from('ap_candidate_news')
        .update({ 
            status: 'approved',
            render_url: 'https://gyooxmpyxncrezjiljrj.supabase.co/storage/v1/object/public/ap-images/admin_uploads/1741785600_test.jpg'
        })
        .eq('id', 'db3bbace-e2bc-487d-ad8f-32a487efae00')
        .select()

    if (error) {
        console.error('Error:', error)
        return
    }

    console.log('Update Result (Approved + Render URL):')
    console.log(JSON.stringify(data, null, 2))
}

update()
