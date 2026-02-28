require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const { data: item, error } = await supabase.from('ap_candidate_news').select('*').order('created_at', { ascending: false }).limit(2);
    console.log("LAST ITEMS:", JSON.stringify(item, null, 2));

    const { data: logs } = await supabase.from('ap_editorial_logs').select('*').order('created_at', { ascending: false }).limit(1);
    console.log("LAST LOG:", JSON.stringify(logs, null, 2));
}
main();
