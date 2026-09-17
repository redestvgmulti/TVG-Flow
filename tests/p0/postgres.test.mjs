import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

// Fixed, isolated --network none container. Never accepts a remote database URL.
const container = 'tvg-p0-editorial-20260909'
const database = `p0_test_${Date.now()}`
function sql(query, db = database) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec','-i',container,'psql','-U','postgres','-d',db,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1'])
    let out = '', err = ''
    child.stdout.on('data', x => { out += x }); child.stderr.on('data', x => { err += x })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim())))
    child.stdin.end(query)
  })
}
const lit = x => x === null ? 'NULL' : `'${String(x).replaceAll("'", "''")}'`
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const tenant = id(1), candidate = id(2), historical = id(9)
const worker = `SET ROLE service_role; SET request.jwt.claims='{"role":"service_role"}';`
const admin = `SET ROLE authenticated; SET request.jwt.claims='{"role":"authenticated","app_role":"admin","cliente_id":"${tenant}","sub":"${id(3)}"}';`
const rpc = (name, args, role=worker) => sql(`${role} SELECT ap.${name}(${args.map(lit).join(',')});`)

test('PostgreSQL migration, immutable lifecycle, historical preservation and concurrent claim', async t => {
  // Add a uniquely named synthetic database. Never reset or drop any existing dataset.
  await sql(`CREATE DATABASE ${database};`, 'postgres')
  assert.equal(await sql("SELECT to_regclass('ap.candidate_news') IS NULL;"), 't')
  await sql(await readFile(new URL('./fixture.sql', import.meta.url),'utf8'))
  // Include the actual existing territorial release trigger; failure/retry depends on it.
  const territorial = await readFile(new URL('../../supabase/migrations/20260804203000_autopublisher_territorial_composer_rpcs.sql',import.meta.url),'utf8')
  await sql(territorial.slice(territorial.indexOf('CREATE OR REPLACE FUNCTION ap.release_territorial_reservation_on_candidate_end()'),territorial.indexOf('REVOKE ALL ON FUNCTION',territorial.indexOf('CREATE OR REPLACE FUNCTION ap.release_territorial_reservation_on_candidate_end()'))))
  const historyBefore = await sql(`SELECT to_jsonb(c)::text FROM ap.candidate_news c WHERE id='${historical}';`)
  const migration = await readFile(new URL('../../supabase/migrations/20260909014825_p0_editorial_publication_render_invariants.sql',import.meta.url),'utf8')
  await sql(migration)
  await t.test('migration does not rewrite history or invent IDs', async () => {
    assert.doesNotMatch(migration, /storage\.objects|guard_render_object_p0|render_storage_object_immutable/)
    const after = JSON.parse(await sql(`SELECT to_jsonb(c)::text FROM ap.candidate_news c WHERE id='${historical}';`))
    for (const key of ['current_generation_id','approved_generation_id','correction_draft']) delete after[key]
    assert.deepEqual(after, JSON.parse(historyBefore))
    assert.equal(await rpc('p0_claim_publication',[historical,'12345']), '')
  })
  await t.test('false posted denied even with a fabricated external ID', async () => {
    await assert.rejects(rpc('mark_candidate_news_posted',[historical,tenant],admin), /LOCAL_PUBLICATION_DISABLED/)
    await sql(`INSERT INTO ap.candidate_news(id,cliente_id,status,content_type,headline,caption,imagem_url) VALUES('${candidate}','${tenant}','pending_render','feed','Human headline','Human caption','https://example.com/source.jpg');`)
    await assert.rejects(sql(`${worker} UPDATE ap.candidate_news SET status='posted',instagram_post_id='999' WHERE id='${candidate}';`),/CANONICAL_TRANSITION_REQUIRED/)
    await assert.rejects(sql(`${worker} UPDATE ap.candidate_news SET published_at=now() WHERE id='${candidate}';`),/CANONICAL_TRANSITION_REQUIRED/)
    await assert.rejects(rpc('p0_begin_render',[candidate],admin),/permission denied/)
    await assert.rejects(sql(`${admin} INSERT INTO ap_private.p0_capabilities VALUES(txid_current(),'${candidate}','approve');`),/permission denied/)
  })
  let first, second, oldGeneration
  const finishRender = async generation => {
    await rpc('p0_record_render_plan',[generation,JSON.stringify({ templateId:'template', layers:{ headline:{text:'Human headline'} } })])
    const path = `${tenant}/${candidate}/${generation}.png`
    const url = `https://project.example/storage/v1/object/public/ap-renders/${path}`
    await rpc('p0_reserve_render_asset',[generation,path])
    await rpc('p0_complete_render',[generation,path,url]); return url
  }
  await t.test('atomic render claim, snapshot freeze, complete generation', async () => {
    first = JSON.parse(await rpc('p0_begin_render',[candidate])).generation_id
    assert.equal(await rpc('p0_begin_render',[candidate]), '')
    await assert.rejects(sql(`${worker} UPDATE ap.candidate_news SET headline='changed while rendering' WHERE id='${candidate}';`), /EDITORIAL_CONTENT_FROZEN/)
    const url = await finishRender(first)
    const outsider = admin.replace(tenant,id(70))
    assert.equal(await sql(`${outsider} SELECT count(*) FROM ap.render_generations;`),'0')
    await assert.rejects(rpc('p0_approve_generation',[candidate,tenant,first,url],outsider),/EDITORIAL_ADMIN_REQUIRED/)
    await assert.rejects(rpc('p0_approve_generation',[candidate,tenant,id(99),url],admin),/REVIEWED_GENERATION_REQUIRED/)
    await assert.rejects(rpc('p0_approve_generation',[candidate,tenant,first,'https://wrong.example'],admin),/REVIEWED_GENERATION_REQUIRED/)
    oldGeneration = await sql(`SELECT to_jsonb(g)::text FROM ap.render_generations g WHERE id='${first}';`)
  })
  await t.test('all editorial field classes locked; technical updates allowed', async () => {
    for (const [field,value] of Object.entries({headline:'changed',caption:'changed',conteudo:'changed',imagem_url:'https://new.example',context_tag:'NEW',content_type:'reels',render_snapshot:'{}',template_id:id(8),patrocinador_id:id(8)})) {
      await assert.rejects(sql(`${admin} UPDATE ap.candidate_news SET ${field}=${lit(value)} WHERE id='${candidate}';`), /EDITORIAL_CONTENT_FROZEN/)
    }
    await sql(`${worker} UPDATE ap.candidate_news SET error_log='technical',render_attempts=2,worker_id='${id(7)}' WHERE id='${candidate}';`)
    await assert.rejects(sql(`${worker} UPDATE ap.render_generations SET render_snapshot='{}' WHERE id='${first}';`), /permission denied/)
    await assert.rejects(sql(`${admin} UPDATE ap.candidate_news SET approved_at=now() WHERE id='${candidate}';`),/CANONICAL_TRANSITION_REQUIRED/)
    await assert.rejects(sql(`UPDATE ap.render_generations SET render_snapshot='{}' WHERE id='${first}';`), /RENDER_GENERATION_IMMUTABLE/)
  })
  await t.test('correction retains A and creates B without changing old generation', async () => {
    const url = JSON.parse(oldGeneration).asset_url
    await rpc('p0_request_correction',[candidate,tenant,url,'Correct headline'],admin)
    const draft = JSON.parse(await sql(`SELECT correction_draft::text FROM ap.candidate_news WHERE id='${candidate}';`))
    assert.equal(await sql(`SELECT render_url FROM ap.candidate_news WHERE id='${candidate}';`), url)
    await assert.rejects(sql(`${admin} UPDATE ap.candidate_news SET headline='underneath' WHERE id='${candidate}';`),/EDITORIAL_CONTENT_FROZEN/)
    await assert.rejects(rpc('p0_submit_correction',[candidate,tenant,JSON.stringify(draft),null,null,null],admin),/EDITORIAL_INPUT_REQUIRED/)
    await rpc('p0_submit_correction',[candidate,tenant,JSON.stringify(draft),'Corrected headline','Corrected caption','https://example.com/source2.jpg'],admin)
    second = JSON.parse(await rpc('p0_begin_render',[candidate])).generation_id
    assert.notEqual(first,second)
    const secondUrl = await finishRender(second)
    await rpc('p0_approve_generation',[candidate,tenant,second,secondUrl],admin)
    assert.equal(await sql(`SELECT approved_generation_id FROM ap.candidate_news WHERE id='${candidate}';`),second)
    assert.equal(await sql(`SELECT to_jsonb(g)::text FROM ap.render_generations g WHERE id='${first}';`),oldGeneration)
    assert.equal(await sql('SELECT count(*) FROM ap.render_generations WHERE asset_path IS NOT NULL;'),'2')
    await assert.rejects(sql(`INSERT INTO ap.render_generations(id,candidate_id,cliente_id,status,render_snapshot,asset_path)
      VALUES('${id(98)}','${candidate}','${tenant}','failed','{}',${lit(`${tenant}/${candidate}/${first}.png`)});`),/duplicate key value/)
  })
  let attempt
  await t.test('two real PostgreSQL transactions: exactly one publisher acquires candidate', async () => {
    await sql(`UPDATE ap.candidate_news SET horario_agendado=now()-interval '1 minute' WHERE id='${candidate}';`)
    assert.equal(await sql(`${worker} SELECT id FROM ap.p0_list_publish_candidates();`),candidate)
    const query = `${worker} BEGIN; SELECT ap.p0_claim_publication('${candidate}','12345'); SELECT pg_sleep(0.3); COMMIT;`
    const results = await Promise.all([sql(query),sql(query)])
    const acquired = results.filter(x=>x.includes('attempt_id'))
    assert.equal(acquired.length,1)
    attempt = JSON.parse(acquired[0]).attempt_id
    assert.equal(await rpc('p0_claim_publication',[candidate,'12345']), '')
    assert.equal(await sql(`${worker} SELECT count(*) FROM ap.p0_list_publish_candidates();`),'0')
  })
  await t.test('safe retry allowed; publishing timeout never reclaimed; no false posted', async () => {
    await rpc('p0_advance_publication',[attempt,'claimed','safe_failed',null,null,'GRAPH_HTTP_500'])
    attempt = JSON.parse(await rpc('p0_claim_publication',[candidate,'12345'])).attempt_id
    await rpc('p0_advance_publication',[attempt,'claimed','container_created','100'])
    await rpc('p0_advance_publication',[attempt,'container_created','publishing'])
    await assert.rejects(rpc('p0_finish_publication',[attempt]),/EXTERNAL_CONFIRMATION_REQUIRED/)
    assert.equal(await rpc('p0_claim_publication',[candidate,'12345']), '')
    await rpc('p0_advance_publication',[attempt,'publishing','confirmed',null,'200'])
    await assert.rejects(sql(`${admin} UPDATE ap.candidate_news SET status='rejected' WHERE id='${candidate}';`),/PUBLICATION_RECONCILIATION_REQUIRED/)
    await rpc('p0_finish_publication',[attempt])
    await rpc('p0_finish_publication',[attempt]) // idempotent reconciliation
    assert.equal(await rpc('p0_claim_publication',[candidate,'12345']), '')
    assert.equal(await sql(`SELECT status||':'||instagram_post_id FROM ap.candidate_news WHERE id='${candidate}';`),'posted:200')
  })
  await t.test('historical values still intact after the entire lifecycle', async () => {
    const after = JSON.parse(await sql(`SELECT to_jsonb(c)::text FROM ap.candidate_news c WHERE id='${historical}';`))
    for (const key of ['current_generation_id','approved_generation_id','correction_draft']) delete after[key]
    assert.deepEqual(after,JSON.parse(historyBefore))
  })
  await t.test('territorial failure releases reservation, bounded retry and stale generation cannot finish', async () => {
    const target=id(20), reservation=id(21)
    await sql(`INSERT INTO ap.territorial_sponsor_reservations(id,status) VALUES('${reservation}','reserved');
      INSERT INTO ap.candidate_news(id,cliente_id,status,content_type,headline,caption,imagem_url,render_contract_version,territorial_reservation_id)
      VALUES('${target}','${tenant}','pending_render','feed','Headline','Caption','https://example.com/source','territorial_composer_v1','${reservation}');`)
    const a=JSON.parse(await rpc('p0_begin_render',[target])).generation_id
    await rpc('p0_record_render_plan',[a,JSON.stringify({templateId:'t',layers:{}})])
    await assert.rejects(rpc('p0_complete_render',[a,null,null]),/INVALID_IMMUTABLE_ASSET_PATH/)
    const failedPath=`${tenant}/${target}/${a}.png`
    await rpc('p0_reserve_render_asset',[a,failedPath])
    assert.equal(await sql(`SELECT asset_path FROM ap.render_generations WHERE id='${a}';`),failedPath)
    await rpc('p0_fail_render',[a,'TEST_FAILURE'])
    assert.equal(await sql(`SELECT status FROM ap.territorial_sponsor_reservations WHERE id='${reservation}';`),'released')
    await rpc('p0_retry_render',[target])
    assert.equal(await sql(`SELECT status FROM ap.territorial_sponsor_reservations WHERE id='${reservation}';`),'reserved')
    const b=JSON.parse(await rpc('p0_begin_render',[target])).generation_id
    await rpc('p0_fail_render',[a,'STALE_FAILURE'])
    assert.equal(await sql(`SELECT status FROM ap.candidate_news WHERE id='${target}';`),'pending_render')
    const path=`${tenant}/${target}/${a}.png`
    await assert.rejects(rpc('p0_complete_render',[a,path,`https://p.example/storage/v1/object/public/ap-renders/${path}`]),/STALE_RENDER_GENERATION/)
    await rpc('p0_fail_render',[b,'FAIL_TWO'])
    await rpc('p0_retry_render',[target])
    const c=JSON.parse(await rpc('p0_begin_render',[target])).generation_id
    await rpc('p0_fail_render',[c,'FAIL_THREE'])
    await assert.rejects(rpc('p0_retry_render',[target]),/RENDER_RETRY_INVALID/)
  })
  await t.test('correction preserves committed sponsor composition and its retry does not consume another reservation', async () => {
    const target=id(30), reservation=id(31)
    const snapshot={render_content:{headline:'Original',caption:'Original caption',source_image_url:'https://example.com/source'},territory:{region_id:id(32)},sponsors:[{id:id(33)}]}
    await sql(`INSERT INTO ap.territorial_sponsor_reservations(id,status) VALUES('${reservation}','reserved');
      INSERT INTO ap.candidate_news(id,cliente_id,status,content_type,headline,caption,imagem_url,render_contract_version,territorial_reservation_id,render_snapshot)
      VALUES('${target}','${tenant}','pending_render','feed','Original','Original caption','https://example.com/source','territorial_composer_v1','${reservation}',${lit(JSON.stringify(snapshot))});`)
    const a=JSON.parse(await rpc('p0_begin_render',[target])).generation_id
    await rpc('p0_record_render_plan',[a,JSON.stringify({templateId:'t',layers:{}})])
    const path=`${tenant}/${target}/${a}.png`, url=`https://p.example/storage/v1/object/public/ap-renders/${path}`
    await rpc('p0_reserve_render_asset',[a,path])
    await rpc('p0_complete_render',[a,path,url])
    await rpc('p0_request_correction',[target,tenant,url,'Correct text'],admin)
    const draft=await sql(`SELECT correction_draft FROM ap.candidate_news WHERE id='${target}';`)
    await rpc('p0_submit_correction',[target,tenant,draft,'New title','New caption','https://example.com/new'],admin)
    const b=JSON.parse(await rpc('p0_begin_render',[target])).generation_id
    await rpc('p0_fail_render',[b,'CORRECTION_FAILURE'])
    await rpc('p0_retry_render',[target])
    const saved=JSON.parse(await sql(`SELECT render_snapshot FROM ap.candidate_news WHERE id='${target}';`))
    assert.deepEqual(saved.territory,snapshot.territory); assert.deepEqual(saved.sponsors,snapshot.sponsors)
    assert.equal(saved.render_content.headline,'New title')
    assert.equal(await sql(`SELECT status FROM ap.territorial_sponsor_reservations WHERE id='${reservation}';`),'committed')
    assert.equal(await sql(`SELECT render_snapshot#>>'{render_snapshot,render_content,headline}' FROM ap.render_generations WHERE id='${a}';`),'Original')
  })
})
