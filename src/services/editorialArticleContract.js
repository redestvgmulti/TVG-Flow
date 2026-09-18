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
  return {
    canEditContent: canEdit,
    canEditProductionIntent: canEdit,
    canSave: canEdit,
    canSubmitForReview: canEdit,
    canApprove: mode === EDITOR_MODES.REVIEW_PREVIEW && canReview,
    canRequestChanges: mode === EDITOR_MODES.REVIEW_PREVIEW && canReview,
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
    description: 'Não foi possível extrair os dados do link. Tente preencher manualmente.',
  },
  IMAGE_UPLOAD_FAILED: {
    title: 'Falha no envio',
    description: 'Não foi possível enviar a imagem. Tente novamente.',
  },
})

const DEFAULT_MESSAGE = Object.freeze({
  title: 'Algo deu errado',
  description: 'Não foi possível concluir a ação. Tente novamente.',
})

export function messageForRpcError(code) {
  return MESSAGES[code] || DEFAULT_MESSAGE
}
