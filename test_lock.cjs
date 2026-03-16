const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const item = { id: "b622fccc-3fc2-495c-9319-7f880247763c" };

  const tests = ['failed', 'failed_render', 'ready_to_publish', 'processing', 'rejected'];

  for (const status of tests) {
    const { data, error } = await supabase.schema("ap").from("candidate_news")
        .update({ status }).eq("id", item.id).select("id");
    
    console.log(`Status '${status}' -> Errors: ${error ? error.message : 'OK'}`);
  }
  
  await supabase.schema("ap").from("candidate_news").update({ status: 'pending_render' }).eq("id", item.id);
}

main();
