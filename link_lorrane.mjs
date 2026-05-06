const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function linkLorrane() {
    const lorraneId = 'f320a9db-adb8-4c04-aa6c-152e3dd182c5'
    const mainTenantId = '00000000-0000-0000-0000-000000000001'

    console.log('Linking Lorrane to TVG Multi...')
    
    const res = await fetch(`${supabaseUrl}/rest/v1/empresa_profissionais`, {
        method: 'POST',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            empresa_id: mainTenantId,
            profissional_id: lorraneId,
            funcao: 'social_media', // Standard function
            ativo: true
        })
    })
    
    if (res.ok) {
        console.log('✅ Lorrane linked to TVG Multi successfully!')
    } else {
        console.error('❌ Error linking Lorrane:', await res.text())
    }
}

linkLorrane()
