const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

async function run() {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'invite',
            email: 'test_user_no_data@tvgflow.com'
        })
    });
    
    if (!res.ok) {
        console.error("Error generateLink without data:", await res.text());
    } else {
        const data = await res.json();
        console.log("Success generateLink without data:", data);
        if (data.user && data.user.id) {
            await fetch(`${supabaseUrl}/auth/v1/admin/users/${data.user.id}`, {
                method: 'DELETE',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            });
        }
    }
}

run();
