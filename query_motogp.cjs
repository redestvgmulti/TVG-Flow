const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Using the service role key we found
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, cliente_id, headline, titulo, status, content_type, processing_started_at, rendered_at, render_url, placid_template_uuid, retry_count')
    .or('headline.ilike.%Vorcaro%,titulo.ilike.%Vorcaro%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching data:', error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

main();
