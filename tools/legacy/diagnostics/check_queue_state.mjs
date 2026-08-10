import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkState() {
  const { data, error } = await supabase
    .schema('ap')
    .from('template_queue_state')
    .select('*')
    .eq('empresa_id', 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9');

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Template Queue State:");
    console.table(data);
  }
}

checkState();
