export const AP_EMPLOYEE_GENERATOR_VERSION = '2026-07-26-p0.2';

export const VISUAL_MODEL_SPONSORS = Object.freeze({
  tvg: 2,
  tvg_img: 1,
} as const);

// Historical slug, accepted ONLY when reading contracts written before the
// rename (telemetry allow-lists, historical snapshots). It is never a valid
// value for a new request and is never written back anywhere.
export const LEGACY_VISUAL_MODELS = Object.freeze({ misto: 'tvg_img' } as const);

export type VisualModel = keyof typeof VISUAL_MODEL_SPONSORS;
export type MasterConfigurationErrorCode =
  | 'MASTER_CONFIG_READ_FAILED'
  | 'MASTER_CONFIG_NOT_FOUND'
  | 'MASTER_MODEL_DISABLED'
  | 'MASTER_CONFIG_INVALID';

type QueryResult<T> = { data: T | null; error: unknown | null };

export class MasterConfigurationError extends Error {
  readonly code: MasterConfigurationErrorCode;
  readonly stage: 'master_render_controls' | 'master_render_configs';
  readonly status: number;

  constructor(
    code: MasterConfigurationErrorCode,
    stage: MasterConfigurationError['stage'],
    status = code === 'MASTER_CONFIG_READ_FAILED' ? 503 : 409,
  ) {
    super(code);
    this.name = 'MasterConfigurationError';
    this.code = code;
    this.stage = stage;
    this.status = status;
  }
}

// Strict, write-path normalizer: a NEW request may only carry a current model.
// The historical slug is deliberately rejected so no new candidate, and no new
// snapshot, can ever be created with it.
export function normalizeVisualModel(value: unknown): VisualModel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VISUAL_MODEL_SPONSORS, normalized)
    ? normalized as VisualModel
    : null;
}

// Read-only normalizer for historical contracts (old master rows, old
// snapshots). Never used to build or rewrite a persisted value.
export function normalizeHistoricalVisualModel(
  value: unknown,
): VisualModel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  const canonical =
    (LEGACY_VISUAL_MODELS as Record<string, string>)[normalized] ?? normalized;
  return Object.prototype.hasOwnProperty.call(VISUAL_MODEL_SPONSORS, canonical)
    ? canonical as VisualModel
    : null;
}

export function isLegacyVisualModel(value: unknown): boolean {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(
      LEGACY_VISUAL_MODELS,
      value.trim().toLowerCase(),
    );
}

// ── Phased rollout ─────────────────────────────────────────────────────────
// The slug rename spans four deploys (see docs/rollout-tvg-img.md). During
// phases 1–3 the database, the generator and two frontend builds can legally
// disagree, so this build has to straddle both contracts. Phase 4 flips one
// environment variable to close the transition — no code change, no second
// review of this file.
export type LegacyInputPolicy = 'accept' | 'reject';

export const LEGACY_INPUT_POLICY_ENV = 'AP_LEGACY_VISUAL_MODEL_INPUT';

// Default 'accept': a deploy that lands before the migration, or beside an old
// browser tab, must not start failing requests. Phase 4 sets it to 'reject'.
export function resolveLegacyInputPolicy(raw: unknown): LegacyInputPolicy {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'reject'
    ? 'reject'
    : 'accept';
}

// Slugs that may still address a master row for a canonical model. Before the
// rename migration the TVG + IMG master is stored as 'misto'; after it, as
// 'tvg_img'. Looking both up is what keeps the tenant addressable across the
// migration window. It never affects what gets WRITTEN: the snapshot always
// freezes the canonical slug.
export function masterLookupSlugs(
  model: VisualModel,
  acceptLegacy = true,
): string[] {
  const aliases = acceptLegacy
    ? Object.entries(LEGACY_VISUAL_MODELS)
      .filter(([, canonical]) => canonical === model)
      .map(([legacy]) => legacy)
    : [];
  return [model, ...aliases];
}

export function sponsorCountForVisualModel(model: VisualModel): number {
  return VISUAL_MODEL_SPONSORS[model];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function masterConfigIssues(
  config: Record<string, unknown> | null,
  contentType: string,
  visualModel: VisualModel,
): string[] {
  if (!config) return ['config'];

  const issues: string[] = [];
  if (config.content_type !== contentType) issues.push('content_type');
  // Compared canonically: during the migration window the row may still carry
  // the historical slug. Reading it is safe precisely because the caller
  // freezes the CANONICAL model into the snapshot, never config.visual_model —
  // so no new matéria is ever born with the retired slug.
  if (normalizeHistoricalVisualModel(config.visual_model) !== visualModel) {
    issues.push('visual_model');
  }
  if (!nonEmpty(config.master_template_uuid)) issues.push('master_template_uuid');

  const layerMap = config.layer_map && typeof config.layer_map === 'object'
    ? config.layer_map as Record<string, unknown>
    : {};
  const requiredLayers = contentType === 'reels'
    ? ['headline', 'visual_title', 'sponsor_1']
    : ['headline', 'news_image', 'visual_title', 'sponsor_1'];
  if (sponsorCountForVisualModel(visualModel) === 2) {
    requiredLayers.push('sponsor_2');
  }

  const resolvedLayerNames: string[] = [];
  for (const key of requiredLayers) {
    if (!nonEmpty(layerMap[key])) {
      issues.push(`layer:${key}`);
    } else {
      resolvedLayerNames.push(String(layerMap[key]).trim());
    }
  }
  if (new Set(resolvedLayerNames).size !== resolvedLayerNames.length) {
    issues.push('layer_collision');
  }
  return issues;
}

async function safeRead<T>(
  stage: MasterConfigurationError['stage'],
  read: () => Promise<QueryResult<T>>,
): Promise<T | null> {
  let result: QueryResult<T>;
  try {
    result = await read();
  } catch {
    throw new MasterConfigurationError('MASTER_CONFIG_READ_FAILED', stage);
  }
  if (result.error) {
    throw new MasterConfigurationError('MASTER_CONFIG_READ_FAILED', stage);
  }
  return result.data ?? null;
}

export async function requireMasterConfiguration(input: {
  contentType: string;
  visualModel: VisualModel;
  readControl: () => Promise<QueryResult<Record<string, unknown>>>;
  readConfig: () => Promise<QueryResult<Record<string, unknown>>>;
}): Promise<Record<string, unknown>> {
  const control = await safeRead('master_render_controls', input.readControl);
  if (control?.kill_switch === true) {
    throw new MasterConfigurationError(
      'MASTER_MODEL_DISABLED',
      'master_render_controls',
    );
  }

  const config = await safeRead('master_render_configs', input.readConfig);
  if (!config) {
    throw new MasterConfigurationError(
      'MASTER_CONFIG_NOT_FOUND',
      'master_render_configs',
    );
  }
  if (config.enabled !== true) {
    throw new MasterConfigurationError(
      'MASTER_MODEL_DISABLED',
      'master_render_configs',
    );
  }
  if (masterConfigIssues(config, input.contentType, input.visualModel).length > 0) {
    throw new MasterConfigurationError(
      'MASTER_CONFIG_INVALID',
      'master_render_configs',
    );
  }
  return config;
}

const SAFE_TOKEN = /^[a-zA-Z0-9_.:@-]{1,96}$/;
const safeToken = (value: unknown) =>
  typeof value === 'string' && SAFE_TOKEN.test(value) ? value : null;

export function buildGeneratorLogEvent(input: {
  articleId?: unknown;
  clientId?: unknown;
  contentType?: unknown;
  visualModel?: unknown;
  stage: unknown;
  code: unknown;
}) {
  return {
    component: 'ap-employee-generator',
    function_version: AP_EMPLOYEE_GENERATOR_VERSION,
    article_id: safeToken(input.articleId),
    client_id: safeToken(input.clientId),
    content_type: safeToken(input.contentType),
    visual_model: safeToken(input.visualModel),
    stage: safeToken(input.stage) || 'unknown',
    code: safeToken(input.code) || 'UNKNOWN',
  };
}

// Public messages never expose database or SQL details.
export function masterConfigurationPublicMessage(
  code: MasterConfigurationErrorCode,
): string {
  if (code === 'MASTER_CONFIG_READ_FAILED') {
    return 'Nao foi possivel carregar a configuracao visual. Tente novamente.';
  }
  if (code === 'MASTER_MODEL_DISABLED') {
    return 'O modelo visual nao esta habilitado para este formato.';
  }
  if (code === 'MASTER_CONFIG_INVALID') {
    return 'A configuracao do modelo visual esta incompleta.';
  }
  return 'Nenhuma configuracao foi encontrada para este modelo visual.';
}
