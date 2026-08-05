export const AP_EMPLOYEE_GENERATOR_VERSION = '2026-08-04-territorial-composer.1';

export const VISUAL_MODEL_FORMATS = Object.freeze({
  tvg: ['feed', 'reels'],
  tvg_img: ['feed', 'reels'],
  individual: ['feed', 'reels'],
  aparecida: ['reels'],
  story: ['story'],
} as const);

export type VisualModel = keyof typeof VISUAL_MODEL_FORMATS;
export type MasterConfigurationErrorCode =
  | 'MASTER_CONFIG_READ_FAILED'
  | 'VISUAL_MODEL_NOT_AVAILABLE'
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

export function normalizeVisualModel(value: unknown): VisualModel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VISUAL_MODEL_FORMATS, normalized)
    ? normalized as VisualModel
    : null;
}

export function isVisualModelAllowedForFormat(
  visualModel: VisualModel,
  contentType: string,
): boolean {
  return (VISUAL_MODEL_FORMATS[visualModel] as readonly string[]).includes(contentType);
}

export function sponsorCountFromConfig(config: Record<string, unknown>): number {
  const count = config.sponsor_count === null || config.sponsor_count === undefined
    ? Number.NaN
    : Number(config.sponsor_count);
  if (!Number.isInteger(count) || count < 0 || count > 2) {
    throw new MasterConfigurationError(
      'MASTER_CONFIG_INVALID',
      'master_render_configs',
    );
  }
  return count;
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
  if (config.visual_model !== visualModel) issues.push('visual_model');
  if (!nonEmpty(config.master_template_uuid)) issues.push('master_template_uuid');

  const sponsorCount = config.sponsor_count === null || config.sponsor_count === undefined
    ? Number.NaN
    : Number(config.sponsor_count);
  if (!Number.isInteger(sponsorCount) || sponsorCount < 0 || sponsorCount > 2) {
    issues.push('sponsor_count');
  }

  const layerMap = config.layer_map && typeof config.layer_map === 'object'
    ? config.layer_map as Record<string, unknown>
    : {};
  const requiredLayers = ['headline', 'visual_title'];
  if (contentType === 'feed' || nonEmpty(layerMap.news_image)) {
    requiredLayers.push('news_image');
  }
  if (sponsorCount >= 1) requiredLayers.push('sponsor_1');
  if (sponsorCount >= 2) requiredLayers.push('sponsor_2');
  if (contentType === 'reels' && nonEmpty(layerMap.news_image)) {
    issues.push('layer:news_image_not_supported');
  }

  const resolvedLayerNames: string[] = [];
  for (const key of requiredLayers) {
    if (!nonEmpty(layerMap[key])) issues.push(`layer:${key}`);
  }
  for (const key of ['headline', 'news_image', 'visual_title', 'sponsor_1', 'sponsor_2']) {
    if (nonEmpty(layerMap[key])) resolvedLayerNames.push(String(layerMap[key]).trim());
  }
  if (new Set(resolvedLayerNames).size !== resolvedLayerNames.length) {
    issues.push('layer_collision');
  }
  return issues;
}

async function safeRead<T>(
  stage: MasterConfigurationError['stage'],
  read: () => PromiseLike<QueryResult<T>>,
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
  readControl: () => PromiseLike<QueryResult<Record<string, unknown>>>;
  readConfig: () => PromiseLike<QueryResult<Record<string, unknown>>>;
}): Promise<Record<string, unknown>> {
  const control = await safeRead('master_render_controls', input.readControl);
  if (control?.kill_switch === true) {
    throw new MasterConfigurationError(
      'VISUAL_MODEL_NOT_AVAILABLE',
      'master_render_controls',
    );
  }

  const config = await safeRead('master_render_configs', input.readConfig);
  if (!config || config.enabled !== true) {
    throw new MasterConfigurationError(
      'VISUAL_MODEL_NOT_AVAILABLE',
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

export function masterConfigurationPublicMessage(
  code: MasterConfigurationErrorCode,
): string {
  if (code === 'MASTER_CONFIG_READ_FAILED') {
    return 'Nao foi possivel carregar a configuracao visual. Tente novamente.';
  }
  if (code === 'MASTER_CONFIG_INVALID') {
    return 'A configuracao desta finalidade esta incompleta.';
  }
  return 'Esta finalidade nao esta disponivel para o formato selecionado.';
}
