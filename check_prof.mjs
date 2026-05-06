const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function checkProf() {
    const res = await fetch(`${supabaseUrl}/rest/v1/profissionais?email=eq.lorranegontijo@tvgflow.com`, {
        method: 'GET',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`
        }
    })
    
    if (res.ok) {
        const data = await res.json()
        if (data.length > 0) {
            console.log('Profissional exists in DB:', data[0])
        } else {
            console.log('Profissional does NOT exist in DB.')
        }
    } else {
        console.error('Error checking profissionais:', await res.text())
    }
}

checkProf()
