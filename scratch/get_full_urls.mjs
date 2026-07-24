import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function getFullUrls() {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, headline, render_url')
    .not('render_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3)

  if (error) {
    console.error(error)
    return
  }

  data.forEach(item => {
    console.log(`ID: ${item.id}`)
    console.log(`Headline: ${item.headline}`)
    console.log(`URL: ${item.render_url}`)
    console.log('---')
  })
}

getFullUrls()
