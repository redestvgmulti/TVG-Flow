require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
    const { data } = await supabase.from('ap_candidate_news').select('id, titulo, headline, caption, context_tag, roteiro_json').order('created_at', { ascending: false }).limit(2);
    console.log(JSON.stringify(data, null, 2));
    const { data: logs } = await supabase.from('ap_editorial_logs').select('prompt_snapshot, model').order('created_at', { ascending: false }).limit(1);
    console.log("\n--- LAST LOG MODEL ---");
    console.log(logs[0]?.model);
}
run();
