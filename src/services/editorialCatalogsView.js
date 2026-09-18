// Pure derivation of "what formats/visual models can I offer right now" for
// the canonical editor. Consolidates logic that today is duplicated as inline
// useMemo chains in both AutoPublisher.jsx and EmployeeMode.jsx, so the new
// editor gets it once instead of a third copy.
import { availableContentTypes, visualModelOptionsForFormat } from './visualModels.js'
import { MASTER_RUNTIME_STATUS, VISUAL_MODELS_STATE, visualModelsStateFor } from './masterRuntime.js'
import { TERRITORIAL_COMPOSER_STATUS } from './territorialComposer.js'

export function deriveEditorialCatalogView({
  territorialComposerEnabled,
  masterRuntimeStatus,
  masterRuntime,
  territorialComposerStatus,
  territorialCatalog,
  contentType,
}) {
  if (territorialComposerEnabled) {
    const ready = territorialComposerStatus === TERRITORIAL_COMPOSER_STATUS.READY
    const availableFormats = ready
      ? (territorialCatalog?.available_formats || []).map(item => ({ slug: item.content_type, label: item.label || item.content_type }))
      : []
    const visualModelsState = territorialComposerStatus === TERRITORIAL_COMPOSER_STATUS.ERROR
      ? VISUAL_MODELS_STATE.ERROR
      : ready
        ? VISUAL_MODELS_STATE.AVAILABLE
        : VISUAL_MODELS_STATE.LOADING
    return { availableFormats, visualModelOptions: [], visualModelsState }
  }

  const control = { kill_switch: masterRuntime?.killSwitch }
  const ready = masterRuntimeStatus === MASTER_RUNTIME_STATUS.READY
  const availableFormats = ready ? availableContentTypes(masterRuntime?.configs, control) : []
  const visualModelOptions = ready && contentType
    ? visualModelOptionsForFormat(masterRuntime?.configs, control, contentType, masterRuntime?.poolCounts)
    : []
  const availableModels = visualModelOptions.filter(model => model.available)
  const visualModelsState = visualModelsStateFor(masterRuntimeStatus, availableModels)
  return { availableFormats, visualModelOptions, visualModelsState }
}
