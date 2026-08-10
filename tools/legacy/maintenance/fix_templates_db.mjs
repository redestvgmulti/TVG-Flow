const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function run() {
    console.log('Fetching templates...');
    const res = await fetch(`${supabaseUrl}/rest/v1/templates?select=id,nome,placid_template_uuid`, {
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Accept-Profile': 'ap'
        }
    });
    
    if (!res.ok) {
        console.error('Failed to fetch:', await res.text());
        return;
    }
    
    const templates = await res.json();
    let fixedCount = 0;
    
    for (const t of templates) {
        const original = t.placid_template_uuid;
        const trimmed = original ? original.trim() : original;
        
        if (original !== trimmed) {
            console.log(`Fixing template "${t.nome}" (${t.id}). Changing "${original}" to "${trimmed}"`);
            
            const updateRes = await fetch(`${supabaseUrl}/rest/v1/templates?id=eq.${t.id}`, {
                method: 'PATCH',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Accept-Profile': 'ap',
                    'Content-Profile': 'ap',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ placid_template_uuid: trimmed })
            });
            
            if (updateRes.ok) {
                console.log(`Successfully fixed ${t.id}`);
                fixedCount++;
            } else {
                console.error(`Failed to fix ${t.id}:`, await updateRes.text());
            }
        }
    }
    
    console.log(`Finished. Fixed ${fixedCount} templates.`);
}

run();
