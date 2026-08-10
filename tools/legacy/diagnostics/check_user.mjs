const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function checkUser() {
    // We can list users via admin API
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'GET',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
        }
    })
    
    if (res.ok) {
        const data = await res.json()
        const user = data.users.find(u => u.email === 'lorranegontijo@tvgflow.com')
        if (user) {
            console.log('User exists in Auth:', user.id)
        } else {
            console.log('User does NOT exist in Auth.')
        }
    } else {
        console.error('Error listing users:', await res.text())
    }
}

checkUser()
