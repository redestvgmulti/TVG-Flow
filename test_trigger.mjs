import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.rpc('get_triggers_ap');
    // If no such function, let's query pg_triggers manually via a small snip or just look at migrations
    console.log(data || error);
}
run();
