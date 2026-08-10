require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    const { data: news, error: err1 } = await db.schema('ap').from('candidate_news')
      .select('id, titulo, criado_por_user_id, status, gerado_em')
      .eq('role_criador', 'employee')
      .order('gerado_em', { ascending: false })
      .limit(5);

    if (err1) console.error("News Error:", err1);
    console.log("Recent News:", JSON.stringify(news, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
  }
})();
