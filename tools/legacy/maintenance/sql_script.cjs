const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const query = `
    CREATE OR REPLACE FUNCTION ap.get_user_emails_for_ap()
    RETURNS TABLE(id uuid, email text)
    LANGUAGE sql
    SECURITY DEFINER
    AS $$
      SELECT id, email FROM auth.users;
    $$;
  `;
  // We can't execute RAW sql directly from js client unless we use a prior rpc that allows execution or REST API 
  console.log("Creating RPC");
}
test();
