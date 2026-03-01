const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
    const { data, error } = await supabase
        .from('ap_candidate_news')
        .select('id')
        .ilike('url_original', 'https://g1.globo.com%')
        .limit(1);

    console.log('GET Data:', data);
    console.log('GET Error:', error);
}
test();
