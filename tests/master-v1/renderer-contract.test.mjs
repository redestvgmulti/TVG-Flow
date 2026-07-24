import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REELS_FIXED_LAYERS = new Set(['logo-tvg-fixo', 'shadow']);

function addImage(layers, layer, url, blockedLayers = new Set()) {
  if (layer && url && !blockedLayers.has(layer)) layers[layer] = { image: url };
}

function addText(layers, layer, text, blockedLayers = new Set()) {
  if (layer && text && !blockedLayers.has(layer)) layers[layer] = { text };
}

function buildLayers({ contentType = 'feed', legacyUuid, masterUuid, masterEnabled, headline, tag, newsImageUrl, titleUrl, sponsors = {}, map = {} }) {
  const templateUuid = masterEnabled && masterUuid ? masterUuid : legacyUuid;
  const blockedLayers = contentType === 'reels' ? REELS_FIXED_LAYERS : new Set();
  const layers = {};

  addText(layers, map.headline, headline, blockedLayers);
  if (contentType === 'feed') addText(layers, map.tag, tag, blockedLayers);
  if (contentType === 'feed') addImage(layers, map.news_image, newsImageUrl, blockedLayers);
  addImage(layers, map.visual_title, titleUrl, blockedLayers);
  for (const [slot, url] of Object.entries(sponsors)) addImage(layers, map[slot], url, blockedLayers);

  return { templateUuid, layers };
}

const feedMap = { news_image: 'news-image', headline: 'headline_news', tag: 'tag_news', visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' };
const reelsMap = { news_image: '', headline: 'headline_news', tag: '', visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' };

test('master válido vence UUID legado', () => {
  assert.equal(buildLayers({ legacyUuid: 'legacy', masterUuid: 'master', masterEnabled: true, map: reelsMap }).templateUuid, 'master');
});

test('legacy permanece fallback', () => {
  assert.equal(buildLayers({ legacyUuid: 'legacy', masterEnabled: false, map: feedMap }).templateUuid, 'legacy');
});

test('Feed prioriza a imagem manual e envia para news_image configurada', () => {
  const manualImage = 'https://assets/manual.png';
  const scrapedImage = 'https://assets/scraped.png';
  const imageForFeed = manualImage || scrapedImage;
  assert.deepEqual(buildLayers({ legacyUuid: 'legacy', map: feedMap, newsImageUrl: imageForFeed }).layers, {
    'news-image': { image: manualImage },
  });
});

test('Feed usa a imagem extraída quando não há imagem manual', () => {
  const manualImage = null;
  const scrapedImage = 'https://assets/scraped.png';
  const imageForFeed = manualImage || scrapedImage;
  assert.deepEqual(buildLayers({ legacyUuid: 'legacy', map: feedMap, newsImageUrl: imageForFeed }).layers, {
    'news-image': { image: scrapedImage },
  });
});

test('Reels nunca envia news_image, mesmo se o mapa estiver preenchido indevidamente', () => {
  const misconfiguredMap = { ...reelsMap, news_image: 'news-image' };
  assert.deepEqual(buildLayers({
    contentType: 'reels',
    legacyUuid: 'legacy',
    map: misconfiguredMap,
    headline: 'Headline',
    newsImageUrl: 'https://assets/noticia.png',
  }).layers, {
    headline_news: { text: 'Headline' },
  });
});

test('Reels não envia tag textual, mesmo se o mapa estiver preenchido indevidamente', () => {
  const misconfiguredMap = { ...reelsMap, tag: 'tag_news' };
  assert.deepEqual(buildLayers({
    contentType: 'reels',
    legacyUuid: 'legacy',
    map: misconfiguredMap,
    headline: 'Headline',
    tag: 'Editorial',
  }).layers, {
    headline_news: { text: 'Headline' },
  });
});

test('Reels envia headline, selo e apenas patrocinador 2 no slot 2', () => {
  assert.deepEqual(buildLayers({
    contentType: 'reels',
    legacyUuid: 'legacy',
    masterUuid: 'rrbcykdqcrqae',
    masterEnabled: true,
    headline: 'Headline',
    titleUrl: 'https://assets/tag.png',
    sponsors: { sponsor_1: null, sponsor_2: 'https://assets/sponsor-2.png' },
    map: reelsMap,
  }), {
    templateUuid: 'rrbcykdqcrqae',
    layers: {
      headline_news: { text: 'Headline' },
      'tag-png': { image: 'https://assets/tag.png' },
      'patrocinador-2': { image: 'https://assets/sponsor-2.png' },
    },
  });
});

test('Reels não envia layers fixas mesmo se forem mapeadas por engano', () => {
  const unsafeMap = { ...reelsMap, visual_title: 'shadow', sponsor_1: 'logo-tvg-fixo' };
  assert.deepEqual(buildLayers({
    contentType: 'reels',
    legacyUuid: 'legacy',
    titleUrl: 'https://assets/tag.png',
    sponsors: { sponsor_1: 'https://assets/sponsor-1.png' },
    map: unsafeMap,
  }).layers, {});
});

test('slots vazios são omitidos sem null, string vazia ou reposicionamento', () => {
  assert.deepEqual(buildLayers({
    contentType: 'reels',
    legacyUuid: 'legacy',
    map: reelsMap,
    sponsors: { sponsor_1: '', sponsor_2: null },
  }).layers, {});
});

test('tag PNG só é enviada com layer e URL', () => {
  assert.deepEqual(buildLayers({ legacyUuid: 'legacy', map: reelsMap, titleUrl: 'title' }).layers, {
    'tag-png': { image: 'title' },
  });
});

test('renderer aplica o contrato visual Feed/Reels e bloqueia layers fixas de Reels', async () => {
  const source = await readFile(new URL('../../supabase/functions/ap-render-engine/index.ts', import.meta.url), 'utf8');
  assert.match(source, /const REELS_FIXED_LAYERS = new Set\(\[\"logo-tvg-fixo\", \"shadow\"\]\)/);
  assert.match(source, /const background = renderFormat === "feed" \?/);
  assert.match(source, /if \(renderFormat === \"feed\"\) addImage\(nextLayers, map\.news_image, background, blockedLayers\)/);
  assert.match(source, /addText\(nextLayers, map\.headline, item\.headline, blockedLayers\)/);
  assert.match(source, /if \(renderFormat === "feed"\) addText\(nextLayers, map\.tag, item\.context_tag \|\| "DESTAQUE", blockedLayers\)/);
  assert.match(source, /if \(layer && url && !blockedLayers\.has\(layer\)\)/);
});
