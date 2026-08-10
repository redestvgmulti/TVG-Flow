require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: news } = await db.from('ap.candidate_news')
    .select('id, titulo, criado_por_user_id')
    .eq('role_criador', 'employee')
    .order('gerado_em', { ascending: false })
    .limit(5);
  console.log("Recent News:", JSON.stringify(news, null, 2));

  const { data: users } = await db.rpc('get_user_emails_for_ap');
  console.log("Users Map:", JSON.stringify(users, null, 2));
})();
