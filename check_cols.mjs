const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function getCols() {
    const res = await fetch(`${supabaseUrl}/rest/v1/profissionais`, {
        method: 'OPTIONS',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`
        }
    })
    
    console.log('Status:', res.status)
    console.log('Headers:', res.headers.get('Allow'))
    // PostgREST returns schema in a specific header or body
    console.log('Body:', await res.text())
}

getCols()
