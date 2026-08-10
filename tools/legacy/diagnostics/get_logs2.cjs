const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function test() {
  const { data, error } = await supabase.schema('ap').from('candidate_news').select('id, titulo, status, render_url, caption, error_message, updated_at, criado_por_user_id, role_criador').order('created_at', { ascending: false }).limit(3);
  console.log("DATA:");
  console.log(JSON.stringify(data, null, 2));
}
test().catch(console.error);
