const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    // Just get the last 50 items in 'selected' status to see what's going on
    const { data, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id, titulo, status, imagem_url, imagem_storage, url_original, source, created_at, content_type')
        .eq('status', 'selected')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) console.error(error);
    else {
        const titles = data.map(d => ({ titulo: d.titulo, hasImage: !!d.imagem_url }));
        console.log("Stats: ", titles.filter(t => !t.hasImage).length, "/", titles.length, " items found without image_url");
        console.log(JSON.stringify(data.slice(0, 10), null, 2));
    }
}

check();
