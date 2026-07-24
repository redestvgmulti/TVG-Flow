import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkRenderedItem() {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, headline, caption, render_url')
    .eq('id', '76272982-94f8-4787-bcf6-9ac8555f1556')
    .single()

  if (error) {
    console.error(error)
    return
  }

  console.log('ID:', data.id)
  console.log('Headline:', data.headline)
  console.log('Render URL:', data.render_url)
}

checkRenderedItem()
