import { describeSourceGuard } from './helpers/guardProcess'

// NOLIMITSRUN (PLAN.md D121): a reply cut at the output limit keeps going
// for as long as the model is mid-answer — no count of ours ends it.
describeSourceGuard({
  title: 'output continuation guard',
  scriptName: 'check-no-output-continuation-cap.mjs',
  sourceRel: 'src/core/backends/modelapi/ModelApiHost.ts',
  tag: 'output-cap-guard',
  plantSnippet:
    '\n// planted count cap\nif (outputContinuations < MODEL_API_CONTINUATIONS_MAX) {}\n',
  plantMessage: 'MODEL_API_CONTINUATIONS_MAX still caps the continuation',
  passMessage: 'no cap ok',
})
