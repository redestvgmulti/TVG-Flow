import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env.local', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=')
    if (key && values.length > 0) {
        env[key.trim()] = values.join('=').trim()
    }
})

const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in .env.local")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testScoring() {
  const adminClienteId = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
  
  // 1. Inserir uma regra de prioridade de teste (Tópico de Interesse)
  console.log("Inserindo regra priority_topic 'Abadiânia'...")
  await supabase.schema('ap').from('editorial_rules').delete().eq('cliente_id', adminClienteId).eq('rule_type', 'priority_topic').eq('value', 'Abadiânia')
  await supabase.schema('ap').from('editorial_rules').insert({ cliente_id: adminClienteId, rule_type: 'priority_topic', value: 'Abadiânia' })

  // 2. Inserir notícia candidata mock com a palavra 'Abadiânia'
  console.log("Inserindo notícia com o termo prioritário...")
  const { data: newsMatch } = await supabase.schema('ap').from('candidate_news').insert({
    cliente_id: adminClienteId,
    titulo: 'Nova prefeitura inaugurada em Abadiânia',
    conteudo: 'A cidade de Abadiânia ganha um novo prédio lindo e maravilhoso.',
    status: 'ready_for_scoring',
    categoria: 'regional',
    fonte_id: null
  }).select('id').single()

  // 3. Inserir notícia sem a palavra (controle)
  console.log("Inserindo notícia de controle (sem o termo)...")
  const { data: newsNoMatch } = await supabase.schema('ap').from('candidate_news').insert({
    cliente_id: adminClienteId,
    titulo: 'Prefeitura inaugurada na cidade X',
    conteudo: 'Uma nova prefeitura foi inaugurada hoje na cidade que não é prioridade.',
    status: 'ready_for_scoring',
    categoria: 'regional',
    fonte_id: null
  }).select('id').single()

  // 4. Invocar ap-scoring-engine via supabase wrapper request
  console.log("Chamando edge function ap-scoring-engine...")
  const { data: responseData, error: functionError } = await supabase.functions.invoke('ap-scoring-engine')

  console.log("Scoring engine response:", functionError ? functionError : responseData)

  // 5. Check scores
  const { data: scores } = await supabase.schema('ap').from('candidate_scores')
    .select('base_score, news_id')
    .in('news_id', [newsMatch.id, newsNoMatch.id])

  console.log("Scores obtidos:")
  console.table(scores)

  // 6. Cleanup
  console.log("Cleaning up test data...")
  await supabase.schema('ap').from('candidate_news').delete().in('id', [newsMatch.id, newsNoMatch.id])
  await supabase.schema('ap').from('editorial_rules').delete().eq('cliente_id', adminClienteId).eq('rule_type', 'priority_topic').eq('value', 'Abadiânia')
}

testScoring().catch(console.error)
