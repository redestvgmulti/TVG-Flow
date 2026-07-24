import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkItem() {
  console.log('Checking item 3dc92f9c...')
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('*')
    .eq('id', '3dc92f9c-29a5-4228-b024-e1b938069d71')
    .single()

  if (error) {
    console.error(error)
    return
  }

  console.log('Headline:', data.headline)
  console.log('Caption (Tag):', data.caption)
  console.log('Template UUID:', data.placid_template_uuid)
  console.log('Render URL:', data.render_url)
}

checkItem()
