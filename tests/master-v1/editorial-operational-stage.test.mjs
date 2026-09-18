import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OPERATIONAL_STAGES,
  operationalStageForEditorialStatus,
} from '../../src/services/editorialOperationalStage.js'

test('operationalStageForEditorialStatus covers the 5 minimum categories from 2B.2.3 section 11', () => {
  assert.equal(operationalStageForEditorialStatus('draft').key, OPERATIONAL_STAGES.IN_PRODUCTION)
  assert.equal(operationalStageForEditorialStatus('editing').key, OPERATIONAL_STAGES.IN_PRODUCTION)
  assert.equal(operationalStageForEditorialStatus('changes_requested').key, OPERATIONAL_STAGES.NEEDS_CORRECTION)
  assert.equal(operationalStageForEditorialStatus('content_final').key, OPERATIONAL_STAGES.IN_REVIEW)
  assert.equal(operationalStageForEditorialStatus('ready_for_render').key, OPERATIONAL_STAGES.PREPARING_RENDER)
  assert.equal(operationalStageForEditorialStatus('dispatched').key, OPERATIONAL_STAGES.COMPLETED)
})

test('operationalStageForEditorialStatus labels are Portuguese and distinct per bucket', () => {
  const labels = new Set([
    operationalStageForEditorialStatus('draft').label,
    operationalStageForEditorialStatus('changes_requested').label,
    operationalStageForEditorialStatus('content_final').label,
    operationalStageForEditorialStatus('ready_for_render').label,
    operationalStageForEditorialStatus('dispatched').label,
  ])
  assert.equal(labels.size, 5)
})

test('an unknown/abandoned status never throws and falls back to a sane bucket', () => {
  assert.doesNotThrow(() => operationalStageForEditorialStatus('abandoned'))
  assert.doesNotThrow(() => operationalStageForEditorialStatus('some_future_status'))
  assert.equal(operationalStageForEditorialStatus(undefined).key, OPERATIONAL_STAGES.IN_PRODUCTION)
})
