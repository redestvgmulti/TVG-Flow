const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function getCompanies() {
    const res = await fetch(`${supabaseUrl}/rest/v1/empresas?select=*`, {
        method: 'GET',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`
        }
    })
    const data = await res.json()
    console.log('Companies:', data)
}

getCompanies()
