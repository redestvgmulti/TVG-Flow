import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data, error } = await supabase.rpc('exec_sql', {
        query: `SELECT event_object_table, trigger_name, event_manipulation, action_statement
                FROM information_schema.triggers
                WHERE event_object_schema = 'ap' AND event_object_table = 'candidate_news';`
    });
    // If we don't have exec_sql, we'll just check candidate_news with a specific curl or assume it is not a trigger.
    console.log(data || error);
}
run();
