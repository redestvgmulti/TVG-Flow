const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function test() {
  const { data, error } = await supabase.schema('ap').from('editorial_settings').select('*');
  console.log('settings AP:', data);
  const { data: v, error: verr } = await supabase.from('vault.secrets').select('*');
  console.log('Vault:', v);
}
test();
