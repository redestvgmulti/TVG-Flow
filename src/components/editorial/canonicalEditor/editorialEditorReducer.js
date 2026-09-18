// Pure state machine for CanonicalEditorialEditor. All Supabase calls happen
// outside this file (in the component); this reducer only decides what the
// UI state should become given an action, so it is testable with node --test
// and no DOM.
import { editorModeForStatus } from '../../../services/editorialArticleContract.js'
import { emptyForm, initialFormFromArticle } from '../../../services/editorialArticleForm.js'

// Fields belonging to the "production intent" RPC. headline/body (the
// "content" concern) are tracked separately since they save through a
// different RPC with its own optimistic-concurrency semantics.
const PRODUCTION_INTENT_KEYS = [
  'origin_type', 'production_input_type', 'content_type', 'visual_model',
  'visual_title_id', 'composer_mode', 'region_id', 'city_id', 'manual_slots',
  'source_image_url',
]

export function initialEditorialEditorState(originType = null) {
  return {
    mode: 'create',
    articleId: null,
    article: null,
    form: emptyForm(originType),
    dirty: { content: false, productionIntent: false },
    revisionNumber: 0,
    status: 'idle',
    error: null,
    conflict: false,
    lastMessage: null,
  }
}

function fieldsDiffer(a, b, keys) {
  return keys.some(key => a[key] !== b[key])
}

function fromArticle(state, article, lastMessage = null) {
  return {
    ...state,
    status: 'idle',
    articleId: article.id,
    article,
    form: initialFormFromArticle(article),
    revisionNumber: article.revision_number ?? state.revisionNumber,
    mode: editorModeForStatus({ hasArticle: true, status: article.status }),
    dirty: { content: false, productionIntent: false },
    conflict: false,
    error: null,
    lastMessage,
  }
}

export function editorialEditorReducer(state, action) {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, status: 'loading', error: null }
    case 'LOAD_SUCCESS':
      return fromArticle(state, action.article)
    case 'LOAD_ERROR':
      return { ...state, status: 'error', error: action.error }

    // Unlike LOAD_SUCCESS, this does not replace `form`/`dirty`: the article
    // was just created empty (start_editorial_article_direct has no
    // headline/body/production-intent columns to report yet), and the
    // in-progress edits the user typed before triggering creation must
    // survive so the draft/production-intent save that immediately follows
    // in the same attempt actually persists them.
    case 'ARTICLE_CREATED':
      return {
        ...state,
        articleId: action.article.id,
        article: action.article,
        revisionNumber: action.article.revision_number ?? 0,
        mode: editorModeForStatus({ hasArticle: true, status: action.article.status }),
      }

    case 'FIELD_CHANGE': {
      const nextForm = typeof action.updater === 'function'
        ? action.updater(state.form)
        : { ...state.form, ...action.updater }
      const contentChanged = nextForm.headline !== state.form.headline || nextForm.body !== state.form.body
      const productionIntentChanged = fieldsDiffer(nextForm, state.form, PRODUCTION_INTENT_KEYS)
      return {
        ...state,
        form: nextForm,
        dirty: {
          content: state.dirty.content || contentChanged,
          productionIntent: state.dirty.productionIntent || productionIntentChanged,
        },
        conflict: false,
      }
    }

    case 'SAVE_START':
      return { ...state, status: 'saving', error: null }
    case 'SAVE_SUCCESS':
      return fromArticle(state, action.article, 'Rascunho salvo.')
    case 'SAVE_CONFLICT':
      return { ...state, status: 'idle', conflict: true, error: action.error }
    case 'SAVE_ERROR':
      return { ...state, status: 'idle', error: action.error }

    case 'SUBMIT_START':
      return { ...state, status: 'submitting', error: null }
    case 'SUBMIT_SUCCESS':
      return fromArticle(state, action.article, 'Enviado para revisão.')
    case 'SUBMIT_CONFLICT':
      return { ...state, status: 'idle', conflict: true, error: action.error }
    case 'SUBMIT_ERROR':
      return { ...state, status: 'idle', error: action.error }

    case 'APPROVE_START':
      return { ...state, status: 'approving', error: null }
    case 'APPROVE_SUCCESS':
      return fromArticle(state, action.article, 'Aprovado para render.')
    case 'APPROVE_CONFLICT':
      return { ...state, status: 'idle', conflict: true, error: action.error }
    case 'APPROVE_ERROR':
      return { ...state, status: 'idle', error: action.error }

    case 'DISPATCH_START':
      return { ...state, status: 'dispatching', error: null }
    case 'DISPATCH_SUCCESS':
      return fromArticle(state, action.article, 'Enviado para renderização.')
    // The editorial approval that got the article to ready_for_render is
    // never undone by a dispatch failure -- article/mode/revisionNumber stay
    // exactly as APPROVE_SUCCESS left them; only the error surfaces, and the
    // read-only view's retry button stays available (status is still
    // ready_for_render).
    case 'DISPATCH_ERROR':
      return { ...state, status: 'idle', error: action.error }

    case 'REQUEST_CHANGES_START':
      return { ...state, status: 'requestingChanges', error: null }
    case 'REQUEST_CHANGES_SUCCESS':
      return fromArticle(state, action.article, 'Matéria devolvida para correção.')
    case 'REQUEST_CHANGES_ERROR':
      return { ...state, status: 'idle', error: action.error }

    case 'DISMISS_MESSAGE':
      return { ...state, lastMessage: null, error: null }

    default:
      return state
  }
}
