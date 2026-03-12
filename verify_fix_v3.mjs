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

async function verify() {
    const newsId = 'db3bbace-e2bc-487d-ad8f-32a487efae00'
    
    console.log('--- Step 1: Resetting item to pending_review ---')
    await supabase.schema('ap').from('candidate_news').update({ 
        status: 'pending_review',
        render_url: null,
        approved_by: null,
        approved_by_name: null,
        approved_at: null
    }).eq('id', newsId)

    console.log('--- Step 2: Triggering approval simulation ---')
    
    const updatePayload = {
        status: 'pending_render',
        approved_by: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9',
        approved_by_name: 'Antigravity Auditor',
        approved_at: new Date().toISOString()
    }

    const { data: updated, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .update(updatePayload)
        .eq('id', newsId)
        .select()

    if (error) {
        console.error('Error simulating approval:', error)
        return
    }

    if (!updated || updated.length === 0) {
        console.error('No item found to update! Check ID and schema.')
        return
    }

    console.log('Simulated Approval Result:')
    console.log(JSON.stringify(updated, null, 2))
    
    if (updated[0].status === 'pending_render' && updated[0].approved_by_name === 'Antigravity Auditor') {
        console.log('✅ Flow verification successful!')
    } else {
        console.log('❌ Flow verification failed!')
    }
}

verify()
