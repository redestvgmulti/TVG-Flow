const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.schema('ap').from('candidate_news').select('id, status, titulo, render_url, processing_started_at, content_type, placid_template_uuid').eq('id', '8e1449bc-bc92-4368-a919-cec202ddcfaa');
  if (error) {
    console.error("Query Error:", error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
run();
