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
  masterConfigurationPublicMessage,
  normalizeVisualModel,
  requireMasterConfiguration,
  sponsorCountForVisualModel,
  type VisualModel,
} from './masterConfiguration.ts';
import {
  buildGeneratorLogEvent,
  buildUnexpectedGeneratorLogEvent,
  resolveCorrelationId,
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
  return errorResponse(
    context,
    error.code,
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
]);

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
      imagem_url: rawImage,
      image_url: rawImageAlias,
      cliente_id: requestedClienteId,
      auth_user_id,
      url_original,
      content_type = 'feed',
      userHeadline: rawHeadline,
      userTag: rawTag,
      context_tag: rawContextTag,
      userText: rawText,
      placid_template_uuid: manualUuid = null,
      visual_title_id = null,
      sponsor_count: rawSponsorCount,
      visual_model: rawVisualModel = null,
      idempotency_key = null,
    } = body;

    const visualModel = normalizeVisualModel(rawVisualModel);
    context = {
      correlationId,
      clientId: requestedClienteId,
      contentType: content_type,
      visualModel: visualModel || rawVisualModel,
      hasVisualTitleId: isUUID(visual_title_id),
      hasSourceImage: Boolean(rawImage || rawImageAlias),
    };
    stage = 'validate_request';
    logEvent(context, stage, 'REQUEST_VALIDATION_STARTED');

    if (!['feed', 'reels'].includes(content_type)) {
      return errorResponse(
        context,
        'VALIDATION_ERROR',
        'content_type invalido.',
        400,
        'request_validation',
      );
    }
    if (
      !titulo || String(titulo).trim().length < 2 ||
      !conteudo || String(conteudo).trim().length < 5
    ) {
      return errorResponse(
        context,
        'VALIDATION_ERROR',
        'Titulo e conteudo sao obrigatorios.',
        400,
        'request_validation',
      );
    }
    if (rawVisualModel === undefined || rawVisualModel === null || rawVisualModel === '') {
      return errorResponse(
        context,
        'MASTER_MODEL_REQUIRED',
        'Selecione o modelo visual antes de gerar a materia.',
        422,
        'request_validation',
      );
    }
    if (!visualModel) {
      return errorResponse(
        context,
        'MASTER_MODEL_INVALID',
        'Modelo visual invalido.',
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
    if (manualUuid) {
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
    const imageUrl = rawImage || rawImageAlias || null;
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
    if (!isUUID(visual_title_id)) {
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
    context = { ...context, clientId: clienteId, visualModel };
    logEvent(context, stage, 'TENANT_RESOLVED');
    stage = 'build_snapshot';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: existingCandidate, error: existingCandidateError } =
      await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id,status,render_contract_version,render_snapshot')
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
      if (existingCandidate.render_contract_version !== 'master_v1') {
        return errorResponse(
          context,
          'IDEMPOTENCY_CONTRACT_MISMATCH',
          'Retries legacy devem continuar pelo snapshot historico.',
          409,
          'build_snapshot',
        );
      }
    }

    const userHeadline = typeof rawHeadline === 'string' && rawHeadline.trim()
      ? rawHeadline.trim()
      : null;
    const userTag = rawTag || rawContextTag
      ? String(rawTag || rawContextTag).toUpperCase().trim()
      : null;
    const userText = typeof rawText === 'string' && rawText.trim()
      ? rawText.trim()
      : null;
    const sponsorCount = sponsorCountForVisualModel(visualModel as VisualModel);
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
      renderSnapshotBase = {
        master_config: {
          id: config.id,
          master_template_uuid: config.master_template_uuid,
          enabled: config.enabled,
          visual_model: config.visual_model,
        },
        visual_model: config.visual_model,
        layer_map: config.layer_map,
      };
      logEvent(context, stage, 'MASTER_CONFIG_LOADED');
    } else {
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
      logEvent(context, stage, 'FROZEN_SNAPSHOT_REUSED');
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
        p_titulo: userHeadline || titulo,
        p_conteudo: userText || conteudo,
        p_url_original: url_original || null,
        p_imagem_url: imageUrl,
        p_context_tag: userTag || 'DESTAQUE',
        p_auth_user_id: authenticatedUserId,
        p_visual_title_id: visual_title_id,
        p_render_contract_version: 'master_v1',
        p_render_snapshot_base: renderSnapshotBase,
      });
    if (rotationError) {
      const safeRpcError = SAFE_RPC_ERRORS.get(rotationError.message);
      return errorResponse(
        context,
        safeRpcError ? rotationError.message : 'SPONSOR_ROTATION_FAILED',
        safeRpcError?.message || 'Nao foi possivel preparar a materia.',
        safeRpcError?.status || 503,
        'call_candidate_rpc',
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
        contentType: content_type as 'feed' | 'reels',
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
