import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function findItem() {
  console.log('Finding recent items...')
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, headline, caption, status')
    .order('updated_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error(error)
    return
  }

  console.table(data)
}

findItem()
