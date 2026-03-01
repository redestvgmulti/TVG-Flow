const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function test() {
  const { data, error } = await supabase.schema('ap').from('candidate_news').select('*').order('created_at', { ascending: false }).limit(2);
  console.log("Error:", error);
  console.log("Raw Data:", data);
}
test().catch(console.error);
