import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
  const { data, error } = await supabase
    .schema('ap')
    .from('templates')
    .select('*')
    .limit(1);

  if (error) {
    console.error("Error:", error);
  } else {
    console.log(Object.keys(data[0]));
  }
}

checkColumns();
