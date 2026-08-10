const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.schema('ap').from('templates').select('*').limit(5);
  if (error) {
    console.error("Query Error:", error);
  } else {
    if (data && data.length > 0) {
      console.log("Columns:", Object.keys(data[0]));
      data.forEach(t => console.log(`ID: ${t.id}, tipo/content_type: ${t.tipo || t.content_type || t.formato}, template_set: ${t.template_set}, placid_uuid: ${t.placid_template_uuid}`));
    } else {
      console.log("No templates found");
    }
  }
}
run();
