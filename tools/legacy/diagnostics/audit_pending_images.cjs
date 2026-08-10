const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id, titulo, status, imagem_url, imagem_storage, url_original, source, created_at')
        .in('status', ['selected', 'studio_selected', 'studio_ready'])
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}

check();
