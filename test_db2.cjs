const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function test() {
  const { data, error } = await supabase.rpc('get_decrypted_secret', { secret_id: 'edde189e-19a0-48a4-abb9-71db27179fae' });
  console.log('Secret:', data ? "FOUND" : "NOT FOUND", error);
}
test();
