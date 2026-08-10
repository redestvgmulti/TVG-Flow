const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id, titulo, imagem_url, studio_media_image_url, url_original')
        .eq('status', 'selected')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) console.error(error);
    else {
        const hasOg = data.filter(d => !!d.studio_media_image_url).length;
        const hasRss = data.filter(d => !!d.imagem_url).length;
        console.log(`Summary of 50 items:\n - Has RSS image: ${hasRss}\n - Has OG image: ${hasOg}`);
        console.log("Samples with OG but no RSS image:");
        console.log(JSON.stringify(data.filter(d => !d.imagem_url && d.studio_media_image_url).slice(0, 5), null, 2));

        console.log("Samples with NO image at all:");
        console.log(JSON.stringify(data.filter(d => !d.imagem_url && !d.studio_media_image_url).slice(0, 5), null, 2));
    }
}

check();
