export const GENERATOR_STAGES = [
  'startup',
  'authenticate',
  'resolve_tenant',
  'parse_request',
  'validate_request',
  'load_master',
  'resolve_visual_title',
  'resolve_source_image',
  'build_snapshot',
  'call_candidate_rpc',
  'complete',
] as const;

export type GeneratorStage = typeof GENERATOR_STAGES[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 240;
const MAX_ERROR_NAME_LENGTH = 80;

export function resolveCorrelationId(value: unknown): string {
  if (typeof value === 'string' && UUID_PATTERN.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  return crypto.randomUUID();
}

function stringValue(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'unknown_error';
  try {
    return String(value);
  } catch {
    return 'unknown_error';
  }
}

function redactSecrets(value: string): string {
  return value
    // JWTs, whether or not they are prefixed by Bearer.
    .replace(/\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[redacted-jwt]')
    // Never retain bearer credentials or an Authorization value.
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bauthorization\s*[:=]\s*[^,;\s]+/gi, 'authorization=[redacted]')
    // Signed/query-string URLs can carry storage or credential material.
    .replace(/https?:\/\/[^\s"'<>]+\?[^\s"'<>]+/gi, '[redacted-url]')
    // Common secret-bearing key/value pairs in SDK and PostgREST messages.
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|secret|token|signature|sig)\s*[:=]\s*[^,;\s]+/gi, '$1=[redacted]');
}

export function sanitizeUnexpectedMessage(error: unknown): string {
  const message = redactSecrets(stringValue(error))
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b(?:PGRST\d+|PostgREST)\b/i.test(message)) {
    return 'postgrest_request_failed';
  }
  if (/\b(?:permission denied|42501)\b/i.test(message)) {
    return 'database_permission_denied';
  }
  if (/\b(?:jwt|authorization|auth)\b/i.test(message)) {
    return 'authentication_operation_failed';
  }
  if (!message) return 'unknown_error';
  return message.slice(0, MAX_MESSAGE_LENGTH);
}

function normalizedStack(error: unknown): string {
  const stack = error instanceof Error && typeof error.stack === 'string'
    ? error.stack
    : '';
  return redactSecrets(stack)
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/:\d+:\d+/g, ':line:column')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4096);
}

// FNV-1a is used only as a stable, non-secret diagnostic fingerprint. The
// original stack is never emitted or returned to the client.
function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function stackFingerprint(error: unknown, stage: GeneratorStage): string {
  const errorName = error instanceof Error && error.name
    ? error.name.slice(0, MAX_ERROR_NAME_LENGTH)
    : 'Error';
  return `fnv1a64:${fnv1a64(`${errorName}\n${normalizedStack(error)}\n${stage}`)}`;
}

function safeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function safeEnum(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

export type GeneratorLogContext = {
  correlationId: string;
  stage: GeneratorStage;
  articleId?: unknown;
  clientId?: unknown;
  contentType?: unknown;
  visualModel?: unknown;
  hasVisualTitleId?: boolean;
  hasSourceImage?: boolean;
};

export function buildGeneratorLogEvent(input: GeneratorLogContext & {
  functionVersion: string;
  code: string;
}) {
  return {
    component: 'ap-employee-generator',
    function_version: input.functionVersion,
    correlation_id: resolveCorrelationId(input.correlationId),
    stage: input.stage,
    code: input.code,
    cliente_id: safeUuid(input.clientId),
    content_type: safeEnum(input.contentType, ['feed', 'reels']),
    // Allow-list, not a write path: 'misto' stays listed only so a rejected
    // legacy request is still observable in the logs instead of vanishing.
    visual_model: safeEnum(input.visualModel, ['tvg', 'tvg_img', 'misto']),
    has_visual_title_id: Boolean(input.hasVisualTitleId),
    has_source_image: Boolean(input.hasSourceImage),
    article_id: safeUuid(input.articleId),
  };
}

export function buildUnexpectedGeneratorLogEvent(input: GeneratorLogContext & {
  functionVersion: string;
  error: unknown;
}) {
  const errorName = input.error instanceof Error && input.error.name
    ? sanitizeUnexpectedMessage(input.error.name).slice(0, MAX_ERROR_NAME_LENGTH)
    : 'Error';
  return {
    ...buildGeneratorLogEvent({ ...input, code: 'UNEXPECTED_GENERATOR_ERROR' }),
    error_name: errorName,
    sanitized_message: sanitizeUnexpectedMessage(input.error),
    stack_fingerprint: stackFingerprint(input.error, input.stage),
  };
}
