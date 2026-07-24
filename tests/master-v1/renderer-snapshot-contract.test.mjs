import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildLegacyLayers,
  buildMasterLayers,
  buildProfileMasterLayers,
  claimPendingRender,
  detectRenderPath,
  prepareRotationV1Render,
  RenderContractError,
} from "../../supabase/functions/ap-render-engine/renderContract.ts";

const SUPABASE_URL = "https://project.test";
const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);

function sponsor(slot, id, path, checksum = CHECKSUM_A) {
  return {
    slot,
    sponsor_id: id,
    name: `Sponsor ${id}`,
    bucket: "ap-master-assets",
    path,
    version: checksum.slice(0, 12),
    sha256: checksum,
  };
}

function candidate({
  contentType = "feed",
  sponsorCount = 0,
  sponsorItems = [],
  layerMap,
  masterTemplateUuid = "master-feed-001",
  imageUrl = "https://images.test/manual.png",
  imageStorage = "scraping/fallback.png",
} = {}) {
  const defaultMap = contentType === "reels"
    ? {
      news_image: "",
      headline: "headline_news",
      tag: "",
      visual_title: "tag-png",
      sponsor_1: "patrocinador-1",
      sponsor_2: "patrocinador-2",
    }
    : {
      news_image: "news-image",
      headline: "headline_news",
      tag: "",
      visual_title: "tag-png",
      sponsor_1: "patrocinador-1",
      sponsor_2: "patrocinador-2",
    };

  return {
    id: "candidate-001",
    cliente_id: "client-001",
    content_type: contentType,
    sponsor_count: sponsorCount,
    headline: "Headline congelada",
    context_tag: "Categoria",
    imagem_url: imageUrl,
    imagem_storage: imageStorage,
    placid_template_uuid: "legacy-template-001",
    render_contract_version: "master_v1",
    render_snapshot: {
      render_contract_version: "master_v1",
      sponsor_source: "rotation_v1",
      master_config: {
        master_template_uuid: masterTemplateUuid,
      },
      layer_map: layerMap ?? defaultMap,
      visual_title: {
        id: "title-001",
        name: "Esporte",
        bucket: "ap-master-assets",
        path: "visual-titles/client/esporte/title-v1.png",
        version: "title-v1",
        sha256: CHECKSUM_A,
      },
      sponsor_selection: {
        requested_count: sponsorCount,
        rotation_version: "sponsor_rotation_v1",
        items: sponsorItems,
      },
    },
  };
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof RenderContractError);
    assert.equal(error.code, code);
    return true;
  });
}

test("identifica legacy, master antigo e rotation_v1 somente por contrato explícito", () => {
  assert.equal(
    detectRenderPath({ render_contract_version: "legacy" }),
    "legacy",
  );
  assert.equal(
    detectRenderPath({
      render_contract_version: "master_v1",
      render_snapshot: {
        render_contract_version: "master_v1",
        sponsor_profile: { slots: {} },
      },
    }),
    "master_profile_v1",
  );
  assert.equal(detectRenderPath(candidate()), "master_rotation_v1");
});

test("snapshot parcial não ativa rotation_v1 nem cai silenciosamente", () => {
  const item = candidate();
  delete item.render_snapshot.master_config;
  expectCode(
    "MASTER_SNAPSHOT_MISSING",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("UUID master ausente falha fechado", () => {
  const item = candidate();
  item.render_snapshot.master_config.master_template_uuid = "";
  expectCode(
    "MASTER_UUID_MISSING",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("selo sem asset imutável falha fechado", () => {
  const item = candidate();
  item.render_snapshot.visual_title.path = "";
  expectCode(
    "VISUAL_TITLE_SNAPSHOT_INVALID",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("rotation_v1 usa UUID e layer map congelados no snapshot", () => {
  const item = candidate({
    masterTemplateUuid: "snapshot-master-001",
    layerMap: {
      news_image: "snapshot-news",
      headline: "snapshot-headline",
      tag: "",
      visual_title: "snapshot-title",
      sponsor_1: "",
      sponsor_2: "",
    },
  });
  item.placid_template_uuid = "legacy-must-not-win";
  const plan = prepareRotationV1Render(item, SUPABASE_URL);
  assert.equal(plan.templateId, "snapshot-master-001");
  assert.deepEqual(Object.keys(plan.layers), [
    "snapshot-news",
    "snapshot-headline",
    "snapshot-title",
  ]);
});

test("sponsor_count 0 omite completamente patrocinadores", () => {
  const plan = prepareRotationV1Render(candidate(), SUPABASE_URL);
  assert.equal(plan.layers["patrocinador-1"], undefined);
  assert.equal(plan.layers["patrocinador-2"], undefined);
});

test("sponsor_count 1 envia somente sponsor_1", () => {
  const item = candidate({
    sponsorCount: 1,
    sponsorItems: [
      sponsor("sponsor_1", "sponsor-a", "sponsors/client/a.png"),
    ],
  });
  const plan = prepareRotationV1Render(item, SUPABASE_URL);
  assert.match(plan.layers["patrocinador-1"].image, /\/a\.png$/);
  assert.equal(plan.layers["patrocinador-2"], undefined);
});

test("sponsor_count 2 envia sponsor_1 e sponsor_2 sem reorganizar", () => {
  const item = candidate({
    sponsorCount: 2,
    sponsorItems: [
      sponsor("sponsor_2", "sponsor-b", "sponsors/client/b.png", CHECKSUM_B),
      sponsor("sponsor_1", "sponsor-a", "sponsors/client/a.png"),
    ],
  });
  const plan = prepareRotationV1Render(item, SUPABASE_URL);
  assert.match(plan.layers["patrocinador-1"].image, /\/a\.png$/);
  assert.match(plan.layers["patrocinador-2"].image, /\/b\.png$/);
});

test("sponsor_2 sozinho é inválido no contrato rotation_v1", () => {
  const item = candidate({
    sponsorCount: 1,
    sponsorItems: [
      sponsor("sponsor_2", "sponsor-b", "sponsors/client/b.png", CHECKSUM_B),
    ],
  });
  expectCode(
    "SPONSOR_SLOT_INVALID",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("quantidade divergente falha fechada", () => {
  const item = candidate({
    sponsorCount: 2,
    sponsorItems: [
      sponsor("sponsor_1", "sponsor-a", "sponsors/client/a.png"),
    ],
  });
  expectCode(
    "SPONSOR_COUNT_MISMATCH",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("slot duplicado falha fechado", () => {
  const item = candidate({
    sponsorCount: 2,
    sponsorItems: [
      sponsor("sponsor_1", "sponsor-a", "sponsors/client/a.png"),
      sponsor("sponsor_1", "sponsor-b", "sponsors/client/b.png", CHECKSUM_B),
    ],
  });
  expectCode(
    "SPONSOR_SLOT_DUPLICATE",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("patrocinador duplicado falha fechado", () => {
  const item = candidate({
    sponsorCount: 2,
    sponsorItems: [
      sponsor("sponsor_1", "same-id", "sponsors/client/a.png"),
      sponsor("sponsor_2", "same-id", "sponsors/client/a2.png"),
    ],
  });
  expectCode(
    "SPONSOR_DUPLICATE",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("slot desconhecido falha fechado", () => {
  const item = candidate({
    sponsorCount: 1,
    sponsorItems: [
      sponsor("sponsor_top", "sponsor-a", "sponsors/client/a.png"),
    ],
  });
  expectCode(
    "SPONSOR_SLOT_INVALID",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("asset de patrocinador incompleto falha fechado", () => {
  const invalid = sponsor(
    "sponsor_1",
    "sponsor-a",
    "sponsors/client/a.png",
  );
  invalid.path = "";
  const item = candidate({ sponsorCount: 1, sponsorItems: [invalid] });
  expectCode(
    "SPONSOR_ASSET_INVALID",
    () => prepareRotationV1Render(item, SUPABASE_URL),
  );
});

test("Feed usa imagem manual antes da imagem de Storage", () => {
  const plan = prepareRotationV1Render(
    candidate({
      imageUrl: "https://images.test/manual.png",
      imageStorage: "scraping/ignored.png",
    }),
    SUPABASE_URL,
  );
  assert.equal(
    plan.layers["news-image"].image,
    "https://images.test/manual.png",
  );
});

test("Feed usa imagem persistida do scraping quando não há URL manual", () => {
  const plan = prepareRotationV1Render(
    candidate({ imageUrl: "", imageStorage: "scraping/fallback.png" }),
    SUPABASE_URL,
  );
  assert.equal(
    plan.layers["news-image"].image,
    `${SUPABASE_URL}/storage/v1/object/public/ap-images/scraping/fallback.png`,
  );
});

test("Feed sem imagem final falha e nunca envia layer vazia", () => {
  expectCode("FEED_NEWS_IMAGE_MISSING", () =>
    prepareRotationV1Render(
      candidate({ imageUrl: "", imageStorage: "" }),
      SUPABASE_URL,
    ));
});

test("Reels não envia imagem, tag textual ou layers fixas", () => {
  const plan = prepareRotationV1Render(
    candidate({
      contentType: "reels",
      masterTemplateUuid: "rrbcykdqcrqae",
      imageUrl: "https://images.test/must-be-ignored.png",
    }),
    SUPABASE_URL,
  );
  assert.deepEqual(Object.keys(plan.layers), ["headline_news", "tag-png"]);
  assert.equal(plan.layers["news-image"], undefined);
  assert.equal(plan.layers["tag_news"], undefined);
  assert.equal(plan.layers["logo-tvg-fixo"], undefined);
  assert.equal(plan.layers.shadow, undefined);
});

test("Reels rejeita news_image, tag textual e nomes de layers fixas", () => {
  const withNews = candidate({ contentType: "reels" });
  withNews.render_snapshot.layer_map.news_image = "news-image";
  expectCode(
    "REELS_NEWS_IMAGE_FORBIDDEN",
    () => prepareRotationV1Render(withNews, SUPABASE_URL),
  );

  const withTag = candidate({ contentType: "reels" });
  withTag.render_snapshot.layer_map.tag = "tag_news";
  expectCode(
    "MASTER_LAYER_MAP_INVALID",
    () => prepareRotationV1Render(withTag, SUPABASE_URL),
  );

  const withFixed = candidate({ contentType: "reels" });
  withFixed.render_snapshot.layer_map.headline = "shadow";
  expectCode(
    "MASTER_LAYER_MAP_INVALID",
    () => prepareRotationV1Render(withFixed, SUPABASE_URL),
  );
});

test("layer map rejeita colisões e chaves lógicas desconhecidas", () => {
  const duplicate = candidate();
  duplicate.render_snapshot.layer_map.visual_title = "headline_news";
  expectCode(
    "MASTER_LAYER_MAP_INVALID",
    () => prepareRotationV1Render(duplicate, SUPABASE_URL),
  );

  const unknown = candidate();
  unknown.render_snapshot.layer_map.sponsor_top = "sponsor-top";
  expectCode(
    "MASTER_LAYER_MAP_INVALID",
    () => prepareRotationV1Render(unknown, SUPABASE_URL),
  );
});

test("nenhum payload contém null, string vazia ou objeto de imagem vazio", () => {
  const item = candidate({
    sponsorCount: 2,
    sponsorItems: [
      sponsor("sponsor_1", "sponsor-a", "sponsors/client/a.png"),
      sponsor("sponsor_2", "sponsor-b", "sponsors/client/b.png", CHECKSUM_B),
    ],
  });
  const serialized = JSON.stringify(
    prepareRotationV1Render(item, SUPABASE_URL).layers,
  );
  assert.doesNotMatch(serialized, /null/);
  assert.doesNotMatch(serialized, /"image":""/);
  assert.doesNotMatch(serialized, /"text":""/);
  assert.doesNotMatch(serialized, /"image":\{\}/);
});

test("snapshot não é mutado e retries produzem payload profundamente idêntico", () => {
  const item = candidate({
    sponsorCount: 1,
    sponsorItems: [
      sponsor("sponsor_1", "sponsor-a", "sponsors/client/a.png"),
    ],
  });
  const before = structuredClone(item.render_snapshot);
  const first = prepareRotationV1Render(item, SUPABASE_URL);
  const second = prepareRotationV1Render(item, SUPABASE_URL);
  assert.deepEqual(first, second);
  assert.deepEqual(item.render_snapshot, before);
});

test("mudanças live posteriores não alteram UUID, map, selo ou patrocinadores", () => {
  const item = candidate({
    sponsorCount: 1,
    sponsorItems: [
      sponsor("sponsor_1", "sponsor-a", "sponsors/client/a-v1.png"),
    ],
  });
  const first = prepareRotationV1Render(item, SUPABASE_URL);
  const liveState = {
    masterTemplateUuid: "master-live-v2",
    layerMap: { headline: "headline-live-v2" },
    visualTitlePath: "visual-titles/live-v2.png",
    sponsorPath: "sponsors/live-v2.png",
    sponsorActive: false,
    rotationOrder: 99,
  };
  Object.assign(liveState, {
    masterTemplateUuid: "master-live-v3",
    sponsorActive: true,
  });
  const second = prepareRotationV1Render(item, SUPABASE_URL);
  assert.deepEqual(second, first);
});

test("master antigo preserva sponsor_2 no slot 2 sem promoção", () => {
  const layers = buildProfileMasterLayers({
    item: {
      content_type: "feed",
      headline: "Headline",
      imagem_url: "https://images.test/news.png",
      render_snapshot: {
        visual_title: {
          bucket: "assets",
          path: "titles/title.png",
        },
        sponsor_profile: {
          slots: {
            sponsor_2: {
              bucket: "assets",
              path: "sponsors/b.png",
            },
          },
        },
      },
    },
    layerMap: {
      news_image: "news-image",
      headline: "headline_news",
      visual_title: "tag-png",
      sponsor_1: "patrocinador-1",
      sponsor_2: "patrocinador-2",
    },
    supabaseUrl: SUPABASE_URL,
  });
  assert.equal(layers["patrocinador-1"], undefined);
  assert.match(layers["patrocinador-2"].image, /\/b\.png$/);
});

test("legacy continua compatível e Reels legacy não recebe news-image", () => {
  const feed = buildLegacyLayers({
    content_type: "feed",
    headline: "Headline",
    context_tag: "Categoria",
    imagem_url: "https://images.test/news.png",
  }, SUPABASE_URL);
  assert.equal(feed["news-image"].image, "https://images.test/news.png");

  const reels = buildLegacyLayers({
    content_type: "reels",
    headline: "Headline",
    context_tag: "Categoria",
    imagem_url: "https://images.test/ignored.png",
  }, SUPABASE_URL);
  assert.equal(reels["news-image"], undefined);
});

test("buildMasterLayers valida quantidade e omite valores vazios", () => {
  expectCode("SPONSOR_COUNT_MISMATCH", () =>
    buildMasterLayers({
      contentType: "feed",
      layerMap: {
        news_image: "news-image",
        headline: "headline_news",
        visual_title: "tag-png",
        sponsor_1: "patrocinador-1",
      },
      headline: "Headline",
      newsImageUrl: "https://images.test/news.png",
      visualTitleUrl: "https://images.test/title.png",
      sponsorCount: 1,
      sponsorItems: [],
    }));
});

function fakeClaimClient(row) {
  return {
    schema() {
      return this;
    },
    from() {
      return this;
    },
    update(values) {
      this.values = values;
      this.filters = [];
      return this;
    },
    eq(column, value) {
      this.filters.push({ kind: "eq", column, value });
      return this;
    },
    is(column, value) {
      this.filters.push({ kind: "is", column, value });
      return this;
    },
    async select() {
      const matches = this.filters.every((filter) => {
        if (filter.kind === "is") return row[filter.column] === filter.value;
        return row[filter.column] === filter.value;
      });
      if (!matches) return { data: [], error: null };
      Object.assign(row, this.values);
      return { data: [{ id: row.id }], error: null };
    },
  };
}

test("claim compare-and-set permite apenas o primeiro worker", async () => {
  const row = {
    id: "candidate-claim",
    status: "pending_render",
    render_url: null,
    render_started_at: null,
  };
  const staleView = structuredClone(row);
  const first = await claimPendingRender(
    fakeClaimClient(row),
    staleView,
    "2026-07-23T18:00:00.000Z",
  );
  const second = await claimPendingRender(
    fakeClaimClient(row),
    staleView,
    "2026-07-23T18:00:01.000Z",
  );
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(row.render_started_at, "2026-07-23T18:00:00.000Z");
});

test("rotation_v1 não possui dependências de catálogo, rotação, profile ou config live", async () => {
  const helper = await readFile(
    new URL(
      "../../supabase/functions/ap-render-engine/renderContract.ts",
      import.meta.url,
    ),
    "utf8",
  );
  for (
    const forbidden of [
      "render_sponsors",
      "render_sponsor_scope_memberships",
      "render_sponsor_rotation_state",
      "ap.patrocinadores",
      "select_sponsor",
      "template_render_profiles",
      "master_render_configs",
    ]
  ) {
    assert.doesNotMatch(helper, new RegExp(forbidden));
  }
  assert.deepEqual(
    prepareRotationV1Render(candidate(), SUPABASE_URL),
    prepareRotationV1Render(candidate(), SUPABASE_URL),
  );
});

test("worker mantém kill switch isolado e exige PNG para Reels", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/functions/ap-render-engine/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const rotationBranch = source.slice(
    source.indexOf('if (path === "master_rotation_v1")'),
    source.indexOf('if (path === "master_profile_v1")'),
  );
  assert.match(rotationBranch, /prepareRotationV1Render/);
  assert.match(rotationBranch, /killSwitchEnabled/);
  assert.doesNotMatch(rotationBranch, /resolveProfileMaster/);
  assert.match(source, /REELS_OUTPUT_NOT_PNG/);
  assert.match(source, /claimPendingRender/);
});
