import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runEditorialWorkflow } from '../_shared/editorialWorkflow.ts';
import {
  resolveVisualTitleForCreation,
  shouldResolveVisualTitleForCreation,
  VisualTitleResolutionError,
} from './visualTitleResolution.ts';
import {
  authorizeOperationalTenant,
  TenantAuthorizationError,
} from './tenantAuthorization.ts';
import {
  AP_EMPLOYEE_GENERATOR_VERSION,
  MasterConfigurationError,
  isVisualModelAllowedForFormat,
  masterConfigurationPublicMessage,
  normalizeVisualModel,
  requireMasterConfiguration,
  sponsorCountFromConfig,
  type VisualModel,
} from './masterConfiguration.ts';
import {
  normalizeComposerMode,
  TERRITORIAL_COMPOSER_CONTRACT,
  territorialComposerEnabled,
  validateTerritorialComposerIntent,
} from './territorialComposer.ts';
import {
  createAndProcessTerritorialCandidate,
  TerritorialCandidateRpcError,
} from './territorialCandidateWorkflow.ts';
import {
  buildGeneratorLogEvent,
  buildUnexpectedGeneratorLogEvent,
  resolveCorrelationId,
  sanitizeUnexpectedMessage,
  type GeneratorStage,
} from './unexpectedErrorTelemetry.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
const ROTATION_TEMPLATE_SET = 'default';

const isUUID = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
const isUrl = (value: unknown) => {
  try {
    new URL(String(value));
    return true;
  } catch {
    return false;
  }
};

type LogContext = {
  correlationId: string;
  articleId?: unknown;
  clientId?: unknown;
  contentType?: unknown;
  visualModel?: unknown;
  hasVisualTitleId?: boolean;
  hasSourceImage?: boolean;
};

function logEvent(
  context: LogContext,
  stage: GeneratorStage,
  code: string,
  level: 'info' | 'error' = 'info',
) {
  const event = buildGeneratorLogEvent({
    ...context,
    functionVersion: AP_EMPLOYEE_GENERATOR_VERSION,
    stage,
    code,
  });
  const serialized = JSON.stringify(event);
  if (level === 'error') console.error(serialized);
  else console.log(serialized);
}

function errorResponse(
  context: LogContext,
  code: string,
  message: string,
  status: number,
  stage: GeneratorStage,
) {
  logEvent(context, stage, code, 'error');
  return new Response(
    JSON.stringify({ error: code, message, correlation_id: context.correlationId }),
    { status, headers: jsonHeaders },
  );
}

function rpcErrorResponse(
  context: LogContext,
  code: string,
  message: string,
  status: number,
  error: unknown,
) {
  const raw = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  console.error(JSON.stringify({
    ...buildGeneratorLogEvent({
      ...context,
      functionVersion: AP_EMPLOYEE_GENERATOR_VERSION,
      stage: 'call_candidate_rpc',
      code,
    }),
    rpc_error_code: typeof raw.code === 'string' ? raw.code.slice(0, 32) : null,
    sanitized_message: sanitizeUnexpectedMessage(raw.message ?? error),
  }));
  return new Response(
    JSON.stringify({ error: code, message, correlation_id: context.correlationId }),
    { status, headers: jsonHeaders },
  );
}
function unexpectedErrorResponse(
  context: LogContext,
  stage: GeneratorStage,
  error: unknown,
) {
  console.error(JSON.stringify(buildUnexpectedGeneratorLogEvent({
    ...context,
    functionVersion: AP_EMPLOYEE_GENERATOR_VERSION,
    stage,
    error,
  })));
  return new Response(
    JSON.stringify({ error: 'INTERNAL_ERROR', correlation_id: context.correlationId }),
    { status: 500, headers: jsonHeaders },
  );
}

const responseForNews = (news: any, reused = false) => ({
  success: true,
  reused,
  news_id: news.id,
  status: news.status,
  headline: news.headline ?? null,
  caption: news.caption ?? null,
  context_tag: news.context_tag ?? null,
  render_pending: news.status === 'pending_render',
});

function visualTitleErrorResponse(
  context: LogContext,
  error: VisualTitleResolutionError,
) {
  const code = error.code === 'VISUAL_TITLE_FORMAT_INVALID'
    ? 'VISUAL_TITLE_FORMAT_MISMATCH'
    : error.code;
  return errorResponse(
    context,
    code,
    'O selo da materia nao esta disponivel para esta criacao.',
    400,
    'resolve_visual_title',
  );
}

function tenantAuthorizationErrorResponse(
  context: LogContext,
  error: TenantAuthorizationError,
) {
  const message = error.code === 'AUTH_REQUIRED'
    ? 'Autenticacao obrigatoria.'
    : error.code === 'AUTH_INVALID'
    ? 'Autenticacao invalida.'
    : error.code === 'AUTH_USER_MISMATCH'
    ? 'A identidade informada nao corresponde ao usuario autenticado.'
    : error.code === 'TENANT_FORBIDDEN'
    ? 'Cliente nao autorizado para este usuario.'
    : 'Nenhum cliente operacional autorizado foi encontrado.';
  return errorResponse(
    context,
    error.code,
    message,
    error.status,
    error.code.startsWith('AUTH_') ? 'authenticate' : 'resolve_tenant',
  );
}

async function claimEditorialProcessing(supabase: any, newsId: string) {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .update({ processing_started_at: new Date().toISOString() })
    .eq('id', newsId)
    .eq('status', 'processing')
    .is('processing_started_at', null)
    .select('id')
    .maybeSingle();
  if (error) throw new Error('EDITORIAL_CLAIM_FAILED');
  return Boolean(data?.id);
}

function existingSnapshotBase(candidate: any): Record<string, unknown> | null {
  const request = candidate?.render_snapshot?.idempotency?.request;
  const base = request?.render_snapshot_base;
  return base && typeof base === 'object' && !Array.isArray(base) ? base : null;
}

const SAFE_RPC_ERRORS = new Map<string, { status: number; message: string }>([
  ['SPONSOR_POOL_INSUFFICIENT', { status: 409, message: 'Patrocinadores ativos insuficientes para este modelo visual.' }],
  ['IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', { status: 409, message: 'Esta tentativa nao corresponde a requisicao original.' }],
  ['VISUAL_TITLE_INVALID', { status: 400, message: 'O selo da materia nao esta disponivel.' }],
  ['TERRITORIAL_COMPOSER_DISABLED', { status: 403, message: 'O compositor territorial nao esta habilitado para este cliente.' }],
  ['COMPOSER_TEMPLATE_UNAVAILABLE', { status: 409, message: 'Nao existe template territorial ativo para este formato.' }],
  ['REGION_UNAVAILABLE', { status: 400, message: 'A regiao selecionada nao esta disponivel.' }],
  ['CITY_UNAVAILABLE', { status: 400, message: 'A cidade selecionada nao esta disponivel.' }],
  ['CITY_TITLE_INCONSISTENT', { status: 409, message: 'O selo vinculado a cidade esta inconsistente.' }],
  ['EDITORIAL_TITLE_UNAVAILABLE', { status: 400, message: 'O selo editorial nao esta disponivel.' }],
  ['VISUAL_TITLE_UNAVAILABLE', { status: 400, message: 'O selo selecionado nao esta disponivel.' }],
  ['MANUAL_ASSET_UNAVAILABLE', { status: 400, message: 'Um asset manual nao esta disponivel.' }],
  ['SOURCE_IMAGE_REQUIRED', { status: 400, message: 'Uma imagem e obrigatoria para este formato.' }],
  ['SOURCE_IMAGE_INVALID', { status: 400, message: 'A imagem de origem precisa usar HTTP ou HTTPS.' }],
  ['SOURCE_IMAGE_NOT_SUPPORTED', { status: 400, message: 'Este formato nao utiliza imagem de origem.' }],
]);

function safeRpcErrorFor(error: unknown) {
  const raw = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = typeof raw.message === 'string' ? raw.message : '';
  const code = [...SAFE_RPC_ERRORS.keys()].find((candidate) =>
    message === candidate || message.startsWith(`${candidate} `)
  );
  if (code) return { code, ...SAFE_RPC_ERRORS.get(code)! };
  if (raw.code === '23505') {
    return {
      code: 'DUPLICATE_CANDIDATE',
      status: 409,
      message: 'Ja existe uma materia ativa com a mesma origem ou titulo.',
    };
  }
  return undefined;
}

Deno.serve(async (req: Request) => {
  const correlationId = resolveCorrelationId(undefined);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let stage: GeneratorStage = 'startup';
  let context: LogContext = { correlationId };
  logEvent(context, stage, 'REQUEST_RECEIVED');
  try {
    stage = 'parse_request';
    const body = await req.json();
    logEvent(context, stage, 'REQUEST_PARSED');
    const {
      titulo,
      conteudo,
      headline,
      text,
      source_image: rawSourceImage,
      imagem_url: rawImage,
      image_url: rawImageAlias,
      cliente_id: requestedClienteId,
      auth_user_id,
      url_original,
      content_type: rawContentType = 'feed',
      userHeadline: rawHeadline,
      userTag: rawTag,
      context_tag: rawContextTag,
      userText: rawText,
      placid_template_uuid: manualUuid = null,
      master_template_uuid: manualMasterUuid = null,
      layer_map: manualLayerMap,
      template_set: manualTemplateSet,
      master_id: manualMasterId,
      visual_title_id = null,
      sponsor_count: rawSponsorCount,
      visual_model: rawVisualModel = null,
      idempotency_key = null,
      composer_mode: rawComposerMode = null,
      region_id = null,
      city_id = null,
      manual_slots: rawManualSlots = [],
    } = body;

    const content_type = String(rawContentType).trim().toLowerCase();
    const requestedHeadline = headline ?? titulo;
    const requestedText = text ?? conteudo;
    const visualModel = normalizeVisualModel(rawVisualModel);
    const normalizedRawVisualModel = typeof rawVisualModel === 'string'
      ? rawVisualModel.trim().toLowerCase()
      : null;
    const historicalMistoRetry = normalizedRawVisualModel === 'misto';
    const composerMode = normalizeComposerMode(rawComposerMode);
    const composerRequested = rawComposerMode !== undefined &&
      rawComposerMode !== null && rawComposerMode !== '';
    context = {
      correlationId,
      clientId: requestedClienteId,
      contentType: content_type,
      visualModel: visualModel || rawVisualModel,
      hasVisualTitleId: isUUID(visual_title_id),
      hasSourceImage: Boolean(rawSourceImage || rawImage || rawImageAlias),
    };
    stage = 'validate_request';
    logEvent(context, stage, 'REQUEST_VALIDATION_STARTED');

    if (!['feed', 'reels', 'story'].includes(content_type)) {
      return errorResponse(
        context,
        'VALIDATION_ERROR',
        'content_type invalido.',
        400,
        'request_validation',
      );
    }
    if (
      !requestedHeadline || String(requestedHeadline).trim().length < 2 ||
      !requestedText || String(requestedText).trim().length < 5
    ) {
      return errorResponse(
        context,
        'VALIDATION_ERROR',
        'Titulo e conteudo sao obrigatorios.',
        400,
        'request_validation',
      );
    }
    if (
      !composerRequested &&
      (rawVisualModel === undefined || rawVisualModel === null || rawVisualModel === '')
    ) {
      return errorResponse(
        context,
        'VISUAL_MODEL_REQUIRED',
        'Selecione a finalidade da arte antes de gerar a materia.',
        422,
        'request_validation',
      );
    }
    if (!composerRequested && !visualModel && !historicalMistoRetry) {
      return errorResponse(
        context,
        'VISUAL_MODEL_INVALID',
        'Finalidade da arte invalida.',
        400,
        'request_validation',
      );
    }
    if (
      !composerRequested && visualModel &&
      !isVisualModelAllowedForFormat(visualModel, content_type)
    ) {
      return errorResponse(
        context,
        'VISUAL_MODEL_FORMAT_MISMATCH',
        'Esta finalidade nao esta disponivel para o formato selecionado.',
        400,
        'request_validation',
      );
    }
    const sponsorCountRequested =
      rawSponsorCount !== undefined && rawSponsorCount !== null &&
      rawSponsorCount !== '';
    if (sponsorCountRequested) {
      return errorResponse(
        context,
        'SPONSOR_COUNT_NOT_ALLOWED',
        'A quantidade de patrocinadores e derivada do modelo visual.',
        400,
        'request_validation',
      );
    }
    if (
      manualUuid || manualMasterUuid || manualLayerMap !== undefined ||
      manualTemplateSet !== undefined || manualMasterId !== undefined
    ) {
      return errorResponse(
        context,
        'MANUAL_TEMPLATE_NOT_ALLOWED',
        'O template e definido pelo modelo visual.',
        400,
        'request_validation',
      );
    }
    if (!isUUID(idempotency_key)) {
      return errorResponse(
        context,
        'VALIDATION_ERROR',
        'idempotency_key e obrigatorio e deve ser UUID.',
        400,
        'request_validation',
      );
    }

    stage = 'resolve_source_image';
    const imageUrl = rawSourceImage || rawImage || rawImageAlias || null;
    logEvent(context, stage, 'SOURCE_IMAGE_RESOLVED');
    if (imageUrl && !isUrl(imageUrl)) {
      return errorResponse(
        context,
        'VALIDATION_ERROR',
        'imagem_url invalida.',
        400,
        'resolve_source_image',
      );
    }
    if (!composerRequested && !isUUID(visual_title_id)) {
      return errorResponse(
        context,
        'VALIDATION_ERROR',
        'visual_title_id e obrigatorio.',
        400,
        'request_validation',
      );
    }

    stage = 'authenticate';
    logEvent(context, stage, 'AUTHENTICATION_STARTED');
    stage = 'resolve_tenant';
    logEvent(context, stage, 'TENANT_RESOLUTION_STARTED');
    let authorization;
    try {
      authorization = await authorizeOperationalTenant({
        authorization: req.headers.get('Authorization'),
        requestedClienteId,
        requestedAuthUserId: auth_user_id,
        createUserClient: (token) =>
          createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_ANON_KEY')!,
            {
              global: { headers: { Authorization: `Bearer ${token}` } },
              auth: { autoRefreshToken: false, persistSession: false },
            },
          ),
      });
    } catch (error) {
      if (error instanceof TenantAuthorizationError) {
        return tenantAuthorizationErrorResponse(context, error);
      }
      throw error;
    }

    const clienteId = authorization.clienteId;
    const authenticatedUserId = authorization.userId;
    context = {
      ...context,
      clientId: clienteId,
      visualModel: visualModel || normalizedRawVisualModel,
    };
    logEvent(context, stage, 'TENANT_RESOLVED');
    stage = 'build_snapshot';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const composerEnabled = await territorialComposerEnabled(
      supabase,
      clienteId,
    );
    if (composerRequested && !composerEnabled) {
      return errorResponse(
        context,
        'TERRITORIAL_COMPOSER_DISABLED',
        'O compositor territorial nao esta habilitado para este cliente.',
        403,
        'request_validation',
      );
    }
    if (!composerRequested && composerEnabled) {
      return errorResponse(
        context,
        'COMPOSER_INTENT_REQUIRED',
        'Selecione o modo de composicao antes de gerar a materia.',
        400,
        'request_validation',
      );
    }

    const expectedContract = composerEnabled
      ? TERRITORIAL_COMPOSER_CONTRACT
      : 'master_v1';

    const { data: existingCandidate, error: existingCandidateError } =
      await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id,status,render_contract_version,render_snapshot,sponsor_count')
        .eq('cliente_id', clienteId)
        .eq('idempotency_key', idempotency_key)
        .maybeSingle();
    if (existingCandidateError) {
      return errorResponse(
        context,
        'CANDIDATE_READ_FAILED',
        'Nao foi possivel verificar esta tentativa. Tente novamente.',
        503,
        'build_snapshot',
      );
    }
    if (existingCandidate) {
      context = { ...context, articleId: existingCandidate.id };
      if (existingCandidate.render_contract_version !== expectedContract) {
        return errorResponse(
          context,
          'IDEMPOTENCY_CONTRACT_MISMATCH',
          'Retries legacy devem continuar pelo snapshot historico.',
          409,
          'build_snapshot',
        );
      }
    }
    if (!composerEnabled && historicalMistoRetry && !existingCandidate) {
      return errorResponse(
        context,
        'VISUAL_MODEL_INVALID',
        'Finalidade da arte invalida para novas materias.',
        400,
        'request_validation',
      );
    }

    const headlineOverride = rawHeadline ?? headline;
    const textOverride = rawText ?? text;
    const userHeadline = typeof headlineOverride === 'string' && headlineOverride.trim()
      ? headlineOverride.trim()
      : null;
    const userTag = rawTag || rawContextTag
      ? String(rawTag || rawContextTag).toUpperCase().trim()
      : null;
    const userText = typeof textOverride === 'string' && textOverride.trim()
      ? textOverride.trim()
      : null;
    if (composerEnabled) {
      // territorial composer branch
      const validationFailure = validateTerritorialComposerIntent({
        mode: composerMode,
        contentType: content_type,
        regionId: region_id,
        cityId: city_id,
        visualTitleId: visual_title_id,
        manualSlots: rawManualSlots,
        rawVisualModel,
      });
      if (validationFailure) {
        return errorResponse(
          context,
          validationFailure.code,
          validationFailure.message,
          validationFailure.status,
          'request_validation',
        );
      }

      const authorizationHeader = req.headers.get('Authorization')!;
      const userSupabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
          global: { headers: { Authorization: authorizationHeader } },
          auth: { autoRefreshToken: false, persistSession: false },
        },
      );

      stage = 'call_candidate_rpc';
      logEvent(context, stage, 'TERRITORIAL_CANDIDATE_RPC_STARTED');
      let territorialResult;
      try {
        territorialResult = await createAndProcessTerritorialCandidate({
          serviceSupabase: supabase,
          userSupabase,
          clienteId,
          idempotencyKey: idempotency_key,
          contentType: content_type,
          composerMode: composerMode!,
          requestedHeadline: String(requestedHeadline).trim(),
          requestedText: String(requestedText).trim(),
          userHeadline,
          userText,
          userTag,
          urlOriginal: typeof url_original === 'string' ? url_original : null,
          imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
          regionId: isUUID(region_id) ? region_id : null,
          cityId: isUUID(city_id) ? city_id : null,
          visualTitleId: isUUID(visual_title_id) ? visual_title_id : null,
          manualSlots: Array.isArray(rawManualSlots) ? rawManualSlots : [],
        });
      } catch (error) {
        if (error instanceof TerritorialCandidateRpcError) {
          const safeRpcError = safeRpcErrorFor(error.raw);
          return rpcErrorResponse(
            context,
            safeRpcError?.code || 'TERRITORIAL_COMPOSER_FAILED',
            safeRpcError?.message || 'Nao foi possivel preparar a materia.',
            safeRpcError?.status || 503,
            error.raw,
          );
        }
        throw error;
      }

      const news = territorialResult.news;
      context = { ...context, articleId: news.id };
      logEvent(
        context,
        stage,
        territorialResult.reused ? 'CANDIDATE_REUSED' : 'CANDIDATE_CREATED',
      );
      if (!territorialResult.claimed) {
        return new Response(
          JSON.stringify(responseForNews(news, true)),
          { status: 202, headers: jsonHeaders },
        );
      }

      stage = 'complete';
      logEvent(context, stage, 'GENERATION_COMPLETED');
      return new Response(
        JSON.stringify(responseForNews(news, territorialResult.reused)),
        { status: 200, headers: jsonHeaders },
      );
    }
    let sponsorCount: number;
    let renderSnapshotBase: Record<string, unknown>;

    // A committed master_v1 candidate is immutable. Its exact original base is
    // sent back to the transactional RPC, which validates semantic equality;
    // retries never consult live title/configuration rows.
    if (shouldResolveVisualTitleForCreation(existingCandidate)) {
      stage = 'resolve_visual_title';
      logEvent(context, stage, 'VISUAL_TITLE_RESOLUTION_STARTED');
      try {
        await resolveVisualTitleForCreation(supabase, {
          visualTitleId: visual_title_id,
          clienteId,
          contentType: content_type,
        });
      } catch (error) {
        if (error instanceof VisualTitleResolutionError) {
          return visualTitleErrorResponse(context, error);
        }
        throw error;
      }

      stage = 'load_master';
      logEvent(context, stage, 'MASTER_CONFIG_LOAD_STARTED');
      let config: Record<string, unknown>;
      try {
        config = await requireMasterConfiguration({
          contentType: content_type,
          visualModel: visualModel as VisualModel,
          readControl: () =>
            supabase
              .schema('ap')
              .from('master_render_controls')
              .select('kill_switch')
              .eq('cliente_id', clienteId)
              .maybeSingle(),
          readConfig: () =>
            supabase
              .schema('ap')
              .from('master_render_configs')
              .select('*')
              .eq('cliente_id', clienteId)
              .eq('content_type', content_type)
              .eq('visual_model', visualModel)
              .maybeSingle(),
        });
      } catch (error) {
        if (error instanceof MasterConfigurationError) {
          return errorResponse(
            context,
            error.code,
            masterConfigurationPublicMessage(error.code),
            error.status,
            stage,
          );
        }
        throw error;
      }

      stage = 'build_snapshot';
      sponsorCount = sponsorCountFromConfig(config);
      renderSnapshotBase = {
        master_config: {
          id: config.id,
          master_template_uuid: config.master_template_uuid,
          enabled: config.enabled,
          visual_model: config.visual_model,
          sponsor_count: sponsorCount,
        },
        visual_model: config.visual_model,
        layer_map: config.layer_map,
      };
      logEvent(context, stage, 'MASTER_CONFIG_LOADED');
    } else {
      if (!existingCandidate) {
        throw new Error('IDEMPOTENCY_CANDIDATE_MISSING');
      }

      const frozenBase = existingSnapshotBase(existingCandidate);
      if (!frozenBase) {
        return errorResponse(
          context,
          'IDEMPOTENCY_SNAPSHOT_INVALID',
          'O snapshot original desta tentativa esta incompleto.',
          409,
          'build_snapshot',
        );
      }
      renderSnapshotBase = frozenBase;
      const frozenSponsorCount = Number(
        existingCandidate.sponsor_count ??
          existingCandidate.render_snapshot?.sponsor_selection?.requested_count ??
          (frozenBase.master_config as Record<string, unknown> | undefined)?.sponsor_count,
      );
      if (
        !Number.isInteger(frozenSponsorCount) ||
        frozenSponsorCount < 0 || frozenSponsorCount > 2
      ) {
        return errorResponse(
          context,
          'IDEMPOTENCY_SNAPSHOT_INVALID',
          'O snapshot original desta tentativa esta incompleto.',
          409,
          'build_snapshot',
        );
      }
      sponsorCount = frozenSponsorCount;
      logEvent(context, stage, 'FROZEN_SNAPSHOT_REUSED');
    }

    const frozenLayerMap = renderSnapshotBase.layer_map as
      | Record<string, unknown>
      | undefined;
    const sourceImageSupported = typeof frozenLayerMap?.news_image === 'string' &&
      frozenLayerMap.news_image.trim().length > 0;
    if (sourceImageSupported && !imageUrl) {
      return errorResponse(
        context,
        'SOURCE_IMAGE_REQUIRED',
        'Uma imagem e obrigatoria para esta finalidade.',
        400,
        'resolve_source_image',
      );
    }
    if (!sourceImageSupported && imageUrl) {
      return errorResponse(
        context,
        'SOURCE_IMAGE_NOT_SUPPORTED',
        'Esta finalidade nao utiliza imagem de origem.',
        400,
        'resolve_source_image',
      );
    }

    stage = 'call_candidate_rpc';
    logEvent(context, stage, 'CANDIDATE_RPC_STARTED');
    const { data: rpcResult, error: rotationError } = await supabase
      .schema('ap')
      .rpc('create_candidate_with_sponsors', {
        p_cliente_id: clienteId,
        p_idempotency_key: idempotency_key,
        p_content_type: content_type,
        p_template_set: ROTATION_TEMPLATE_SET,
        p_sponsor_count: sponsorCount,
        p_titulo: userHeadline || requestedHeadline,
        p_conteudo: userText || requestedText,
        p_url_original: url_original || null,
        p_imagem_url: imageUrl,
        p_context_tag: userTag || 'DESTAQUE',
        p_auth_user_id: authenticatedUserId,
        p_visual_title_id: visual_title_id,
        p_render_contract_version: 'master_v1',
        p_render_snapshot_base: renderSnapshotBase,
      });
    if (rotationError) {
      const safeRpcError = safeRpcErrorFor(rotationError);
      return rpcErrorResponse(
        context,
        safeRpcError?.code || 'SPONSOR_ROTATION_FAILED',
        safeRpcError?.message || 'Nao foi possivel preparar a materia.',
        safeRpcError?.status || 503,
        rotationError,
      );
    }

    const news = rpcResult?.candidate_news;
    if (!news?.id) {
      return errorResponse(
        context,
        'SPONSOR_ROTATION_INVALID_RESPONSE',
        'Nao foi possivel preparar a materia.',
        503,
        'call_candidate_rpc',
      );
    }
    context = { ...context, articleId: news.id };
    logEvent(
      context,
      stage,
      rpcResult.reused ? 'CANDIDATE_REUSED' : 'CANDIDATE_CREATED',
    );
    stage = 'complete';
    logEvent(context, stage, 'EDITORIAL_PROCESSING_STARTED');

    if (
      rpcResult.reused &&
      ['pending_render', 'pending_review', 'approved'].includes(news.status)
    ) {
      return new Response(
        JSON.stringify(responseForNews(news, true)),
        { status: 200, headers: jsonHeaders },
      );
    }
    if (!await claimEditorialProcessing(supabase, news.id)) {
      return new Response(
        JSON.stringify(responseForNews(news, true)),
        { status: 202, headers: jsonHeaders },
      );
    }

    try {
      const result = await runEditorialWorkflow(supabase, {
        newsId: news.id,
        clienteId,
        userHeadline,
        userTag,
        userText,
        contentType: content_type as any,
      });
      const { error: updateError } = await supabase
        .schema('ap')
        .from('candidate_news')
        .update({
          status: 'pending_render',
          headline: result.headline,
          caption: result.caption,
          context_tag: result.context_tag,
          roteiro_json: result.roteiro_json,
          processing_started_at: null,
        })
        .eq('id', news.id);
      if (updateError) throw new Error('CANDIDATE_UPDATE_FAILED');

      logEvent(context, stage, 'GENERATION_COMPLETED');
      return new Response(
        JSON.stringify(responseForNews({
          ...news,
          status: 'pending_render',
          headline: result.headline,
          caption: result.caption,
          context_tag: result.context_tag,
        }, Boolean(rpcResult.reused))),
        { status: 200, headers: jsonHeaders },
      );
    } catch (editorialError) {
      await supabase
        .schema('ap')
        .from('candidate_news')
        .update({ processing_started_at: null })
        .eq('id', news.id)
        .eq('status', 'processing');
      throw editorialError;
    }
  } catch (error) {
    return unexpectedErrorResponse(context, stage, error);
  }
});

// This endpoint only creates master_v1 candidates. Historical legacy retries
// remain supported by ap-render-engine from the immutable candidate snapshot;
// no new manual request can consult ap.templates or template_render_profiles.
console.log(JSON.stringify({
  component: 'ap-employee-generator',
  function_version: AP_EMPLOYEE_GENERATOR_VERSION,
  stage: 'startup',
  code: 'FUNCTION_READY',
}));
