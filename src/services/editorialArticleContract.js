// Pure status/permission/error-message rules for the canonical editorial
// editor (2B.2.2). The database is always the real authority (RLS + the
// FORBIDDEN/ARTICLE_NOT_EDITABLE checks already inside every RPC) -- these
// functions only decide what the UI shows, mirroring what the backend would
// already accept or refuse, never deciding access on their own.

export const EDITOR_MODES = Object.freeze({
  CREATE: 'create',
  EDIT: 'edit',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_PREVIEW: 'review_preview',
  READ_ONLY: 'read_only',
})

const READ_ONLY_STATUSES = new Set(['ready_for_render', 'dispatched', 'abandoned'])
const EDITABLE_STATUSES = new Set(['draft', 'editing'])

export function isArticleReadOnly(status) {
  return READ_ONLY_STATUSES.has(status)
}

export function editorModeForStatus({ hasArticle, status }) {
  if (!hasArticle) return EDITOR_MODES.CREATE
  if (isArticleReadOnly(status)) return EDITOR_MODES.READ_ONLY
  if (status === 'changes_requested') return EDITOR_MODES.CHANGES_REQUESTED
  if (EDITABLE_STATUSES.has(status)) return EDITOR_MODES.EDIT
  if (status === 'content_final') return EDITOR_MODES.REVIEW_PREVIEW
  return EDITOR_MODES.READ_ONLY
}

export function allowedActionsForMode(mode, { isResponsible = false, canReview = false } = {}) {
  const editable = mode === EDITOR_MODES.CREATE || mode === EDITOR_MODES.EDIT || mode === EDITOR_MODES.CHANGES_REQUESTED
  const canEdit = editable && (isResponsible || canReview)
  const canReviewArticle = isResponsible || canReview
  return {
    canEditContent: canEdit,
    canEditProductionIntent: canEdit,
    canSave: canEdit,
    canSubmitForReview: canEdit,
    canApprove: mode === EDITOR_MODES.REVIEW_PREVIEW && canReviewArticle,
    canRequestChanges: mode === EDITOR_MODES.REVIEW_PREVIEW && canReviewArticle,
  }
}

const MESSAGES = Object.freeze({
  EDITORIAL_REVISION_CONFLICT: {
    title: 'Atualizada em outra sessão',
    description: 'Esta matéria foi atualizada em outra sessão. Recarregue para continuar.',
  },
  EDITORIAL_CONTENT_REQUIRED: {
    title: 'Conteúdo obrigatório',
    description: 'Preencha manchete e corpo antes de salvar.',
  },
  SOURCE_TITLE_REQUIRED: {
    title: 'Headline obrigatória',
    description: 'Informe uma headline para a IA preparar a matéria.',
  },
  SOURCE_BODY_REQUIRED: {
    title: 'Texto-base obrigatório',
    description: 'Informe um texto-base para a IA preparar a matéria.',
  },
  ARTICLE_NOT_EDITABLE: {
    title: 'Matéria não editável',
    description: 'Esta matéria não pode mais ser editada neste estado.',
  },
  CONTENT_ALREADY_FINAL: {
    title: 'Conteúdo já finalizado',
    description: 'Esta matéria já foi finalizada.',
  },
  ARTICLE_NOT_FOUND: {
    title: 'Matéria não encontrada',
    description: 'Esta matéria não existe ou você não tem acesso a ela.',
  },
  FORBIDDEN: {
    title: 'Sem permissão',
    description: 'Você não tem permissão para esta ação.',
  },
  AUTH_REQUIRED: {
    title: 'Sessão expirada',
    description: 'Faça login novamente para continuar.',
  },
  AUTH_INVALID: {
    title: 'Sessão expirada',
    description: 'Faça login novamente para continuar.',
  },
  EDITORIAL_WORKFLOW_DISABLED: {
    title: 'Editor desativado',
    description: 'O editor editorial ainda não está habilitado para este cliente.',
  },
  ARTICLE_NOT_UNDER_REVIEW: {
    title: 'Fora de revisão',
    description: 'Esta matéria não está aguardando revisão.',
  },
  PRODUCTION_INTENT_REQUIRED: {
    title: 'Formato pendente',
    description: 'Defina o formato e o visual antes de aprovar.',
  },
  EDITORIAL_REASON_REQUIRED: {
    title: 'Motivo obrigatório',
    description: 'Informe um motivo para devolver a matéria.',
  },
  REQUEST_ID_REQUIRED: {
    title: 'Erro interno',
    description: 'Falha ao preparar a solicitação. Tente novamente.',
  },
  ORIGIN_TYPE_INVALID: {
    title: 'Origem inválida',
    description: 'Selecione uma origem válida.',
  },
  ORIGIN_REFERENCE_NOT_ALLOWED: {
    title: 'Referência inválida',
    description: 'Origem de texto não usa link.',
  },
  ORIGIN_REFERENCE_URL_REQUIRED: {
    title: 'Link obrigatório',
    description: 'Informe uma URL válida (http:// ou https://).',
  },
  CONTENT_TYPE_INVALID: {
    title: 'Formato inválido',
    description: 'Selecione feed, reels ou story.',
  },
  INVALID_SOURCE_IMAGE: {
    title: 'Imagem inválida',
    description: 'A URL da imagem precisa ser válida.',
  },
  UNEXPECTED_EMPTY_RESULT: {
    title: 'Erro inesperado',
    description: 'Não foi possível confirmar a operação. Tente novamente.',
  },
  SOURCE_SCRAPE_FAILED: {
    title: 'Falha ao extrair link',
    description: 'Não foi possível obter o conteúdo completo desta matéria.',
  },
  EDITORIAL_AI_FLAG_LOAD_FAILED: {
    title: 'Preparação indisponível',
    description: 'Não foi possível confirmar a preparação automática. Tente novamente.',
  },
  EDITORIAL_SOURCE_REQUIRED: {
    title: 'Fonte obrigatória',
    description: 'Informe o texto original antes de preparar a matéria.',
  },
  EDITORIAL_SOURCE_ALREADY_CAPTURED: {
    title: 'Fonte já registrada',
    description: 'A fonte original desta matéria já foi preservada e não pode ser substituída.',
  },
  EDITORIAL_AI_DRAFT_IN_PROGRESS: {
    title: 'Preparação em andamento',
    description: 'A matéria já está sendo preparada. Aguarde alguns instantes.',
  },
  EDITORIAL_AI_HUMAN_REVISION_PRESENT: {
    title: 'Edição humana preservada',
    description: 'A matéria já foi editada e não será sobrescrita automaticamente.',
  },
  EDITORIAL_AI_REVISION_CONFLICT: {
    title: 'Edição humana preservada',
    description: 'A matéria mudou durante a preparação. Recarregue para manter a edição mais recente.',
  },
  EDITORIAL_AI_PREPARATION_FAILED: {
    title: 'Não foi possível preparar a matéria',
    description: 'Não foi possível preparar a matéria automaticamente.',
  },
  EDITORIAL_AI_INVALID_JSON: {
    title: 'Resposta inválida',
    description: 'Não foi possível preparar a matéria automaticamente.',
  },
  EDITORIAL_AI_TIMEOUT: {
    title: 'Tempo esgotado',
    description: 'A preparação demorou mais que o esperado. Tente novamente.',
  },
  IMAGE_UPLOAD_FAILED: {
    title: 'Falha no envio',
    description: 'Não foi possível enviar a imagem. Tente novamente.',
  },
  IMAGE_TYPE_UNSUPPORTED: {
    title: 'Formato não suportado',
    description: 'Use uma imagem PNG, JPG ou WebP.',
  },
  EDITORIAL_UPLOAD_SCOPE_FAILED: {
    title: 'Acesso não confirmado',
    description: 'Não foi possível confirmar o espaço desta matéria. Tente novamente.',
  },
  BACKLOG_NOT_FOUND: {
    title: 'Pauta não encontrada',
    description: 'Esta pauta não existe mais no banco de pautas.',
  },
  BACKLOG_NOT_ADOPTED: {
    title: 'Pauta não adotada',
    description: 'Esta pauta precisa ser adotada antes de iniciar a produção.',
  },
  BACKLOG_NOT_OWNED: {
    title: 'Pauta de outra pessoa',
    description: 'Esta pauta foi adotada por outra pessoa da equipe.',
  },
  COLLECTED_NEWS_ALREADY_IN_PRODUCTION: {
    title: 'Matéria em produção',
    description: 'Esta matéria já está sendo produzida por outro usuário.',
  },
  COLLECTED_NEWS_SCRAPE_REQUIRED: {
    title: 'Conteúdo incompleto',
    description: 'Não foi possível obter o conteúdo completo desta matéria.',
  },
  BACKLOG_LEGACY_CANDIDATE_LINKED: {
    title: 'Pauta já em produção',
    description: 'Esta pauta já está vinculada a uma produção pelo fluxo antigo.',
  },
  DISPATCH_FAILED: {
    title: 'Falha ao enviar para renderização',
    description: 'A matéria foi aprovada, mas o envio para renderização falhou. Tente novamente.',
  },
})

const DEFAULT_MESSAGE = Object.freeze({
  title: 'Algo deu errado',
  description: 'Não foi possível concluir a ação. Tente novamente.',
})

export function messageForRpcError(code) {
  return MESSAGES[code] || DEFAULT_MESSAGE
}

export const CREATION_MODES = Object.freeze({
  CANONICAL: 'canonical',
  LEGACY: 'legacy',
  PENDING: 'pending',
})

// Single source of truth for "which creation UI does a host render", used by
// both AutoPublisher.jsx and EmployeeMode.jsx instead of each having its own
// ad hoc ternary -- keeps the decision testable and identical in both places
// (2B.2.3 section 24: same domain, same rules, regardless of who's asking).
export function resolveCreationMode(editorialFlagEnabled, { loading = false, error = false } = {}) {
  if (loading || error || typeof editorialFlagEnabled !== 'boolean') return CREATION_MODES.PENDING
  return editorialFlagEnabled ? CREATION_MODES.CANONICAL : CREATION_MODES.LEGACY
}

// An article sits in ready_for_render until dispatch succeeds -- this is
// true whether it just failed a dispatch attempt or an admin simply closed
// the tab before dispatch ran. Either way, "show the manual retry action" is
// the same rule (2B.2.3 sections 17 and 20 share one mechanism).
export function canRetryDispatch(status) {
  return status === 'ready_for_render'
}

export function dispatchButtonLabel(hasPendingError) {
  return hasPendingError ? 'Tentar enviar para render novamente' : 'Enviar para render'
}
