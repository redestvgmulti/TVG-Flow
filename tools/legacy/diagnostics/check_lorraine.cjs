require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("Checking profissionais table for email...");
    const { data: profs, error: profsError } = await supabase
        .from('profissionais')
        .select('*')
        .ilike('email', '%lorranegontijo%');
    
    if (profsError) {
        console.error("Error fetching profissionais:", profsError);
    } else {
        console.log("Profissionais found:", JSON.stringify(profs, null, 2));
    }

    console.log("\nChecking auth.users for email...");
    // auth.users requires service_role key
    const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) {
        console.error("Error fetching auth users:", usersError);
    } else {
        const found = users.users.filter(u => u.email && u.email.includes('lorranegontijo'));
        console.log("Auth users found:", JSON.stringify(found, null, 2));
    }
}

run();
