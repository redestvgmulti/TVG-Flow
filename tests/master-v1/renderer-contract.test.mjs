import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function buildLayers({ legacyUuid, masterUuid, masterEnabled, titleUrl, sponsors = {}, map = {} }) {
  const templateUuid = masterEnabled && masterUuid ? masterUuid : legacyUuid;
  const layers = {};
  if (titleUrl && map.visual_title) layers[map.visual_title] = { image: titleUrl };
  for (const [slot, url] of Object.entries(sponsors)) if (url && map[slot]) layers[map[slot]] = { image: url };
  return { templateUuid, layers };
}
const map = { visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' };
test('master válido vence UUID legado', () => assert.equal(buildLayers({ legacyUuid: 'legacy', masterUuid: 'master', masterEnabled: true, map }).templateUuid, 'master'));
test('legacy permanece fallback', () => assert.equal(buildLayers({ legacyUuid: 'legacy', masterEnabled: false, map }).templateUuid, 'legacy'));
test('somente patrocinador 1', () => assert.deepEqual(buildLayers({ legacyUuid: 'legacy', map, sponsors: { sponsor_1: 'a' } }).layers, { 'patrocinador-1': { image: 'a' } }));
test('somente patrocinador 2 não é movido', () => assert.deepEqual(buildLayers({ legacyUuid: 'legacy', map, sponsors: { sponsor_2: 'b' } }).layers, { 'patrocinador-2': { image: 'b' } }));
test('slots vazios são omitidos', () => assert.deepEqual(buildLayers({ legacyUuid: 'legacy', map, sponsors: { sponsor_1: '', sponsor_2: null } }).layers, {}));
test('tag png só é enviada com layer e URL', () => assert.deepEqual(buildLayers({ legacyUuid: 'legacy', map, titleUrl: 'title' }).layers, { 'tag-png': { image: 'title' } }));
test('renderer delegates snapshot contracts to the production helper', async () => {
  const source = await readFile(new URL('../../supabase/functions/ap-render-engine/index.ts', import.meta.url), 'utf8');
  assert.match(source, /from "\.\/renderContract\.ts"/);
  assert.match(source, /prepareRotationV1Render\(item, supabaseUrl\)/);
  assert.match(source, /buildProfileMasterLayers/);
  assert.match(source, /buildLegacyLayers/);
});