import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkData() {
  console.log('Checking latest items in ap.candidate_news...')
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, titulo, headline, caption, context_tag, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Error fetching data:', error)
    return
  }

  console.table(data.map(item => ({
    id: item.id.slice(0, 8),
    status: item.status,
    hasHeadline: !!item.headline,
    hasCaption: !!item.caption,
    hasTag: !!item.context_tag,
    headline: item.headline?.slice(0, 20) || 'NULL',
    caption: item.caption?.slice(0, 20) || 'NULL',
    tag: item.context_tag || 'NULL'
  })))
}

checkData()
