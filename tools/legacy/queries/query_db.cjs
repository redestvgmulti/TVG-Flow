const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });

// In case the key is invalid in auth header, we can use anon key + service role key, but usually service_role key is enough for createClient
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.schema('ap').from('candidate_news').select('id, status, error_log, titulo, render_url, placid_template_uuid').order('criado_em', { ascending: false }).limit(2);
  if (error) {
    console.error("Query Error:", error);
  } else {
    console.log("Last ap.candidate_news records:", JSON.stringify(data, null, 2));
  }
}
run();
