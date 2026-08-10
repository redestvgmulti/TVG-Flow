const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function run() {
    const email = 'lorrane.test@tvgflow.com'
    const nome = 'Lorrane Test'

    console.log('Generating invite link for:', email)
    
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'invite',
            email: email,
            options: {
                data: { nome: nome }
            }
        })
    })
    
    const text = await res.text()
    console.log('Status:', res.status)
    console.log('Response:', text)
}

run()
