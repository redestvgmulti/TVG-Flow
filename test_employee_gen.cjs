const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log('Testing Edge Function with Empresa ID:', '1e194121-8727-4a7b-a01b-52c673ba7170');
  const { data, error } = await supabase.functions.invoke('ap-employee-generator', {
    body: {
      empresa_id: '1e194121-8727-4a7b-a01b-52c673ba7170',
      titulo: 'Test News',
      conteudo: 'This is a test content',
      url_original: 'https://g1.globo.com/mundo/noticia/test-' + Date.now(),
      auth_user_id: 'some-user-id'
    }
  });
  console.log('Data:', data);
  console.log('Error:', error);
  if (error && error.context) {
    try {
      const text = await error.context.text();
      console.log('Error Body:', text);
    } catch (e) {
      console.log('Could not read error body', e)
    }
  }
}
test();
