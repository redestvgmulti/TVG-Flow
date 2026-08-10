const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function check() {
    const res = await fetch(`${supabaseUrl}/rest/v1/templates?select=id,nome,placid_template_uuid,tipo,template_set`, {
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Accept-Profile': 'ap'
        }
    });
    const data = await res.json();
    console.log(`Found ${data.length} templates`);
    const badTemplates = data.filter(t => t.placid_template_uuid !== t.placid_template_uuid.trim());
    console.log('Templates with spaces/tabs in UUID:');
    console.log(JSON.stringify(badTemplates, null, 2));
}

check()
