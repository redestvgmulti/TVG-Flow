export const AP_EMPLOYEE_GENERATOR_VERSION = '2026-07-26-p0.1';

export const VISUAL_MODEL_SPONSORS = Object.freeze({
  tvg: 2,
  misto: 1,
} as const);

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

export function normalizeVisualModel(value: unknown): VisualModel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VISUAL_MODEL_SPONSORS, normalized)
    ? normalized as VisualModel
    : null;
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
  if (config.visual_model !== visualModel) issues.push('visual_model');
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
