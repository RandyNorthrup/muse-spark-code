import { describeSourceGuard } from './helpers/guardProcess'

// NOLIMITSRUN (PLAN.md D121): no round count of ours ends a turn; a caller's
// own allowance still bounds its run.
describeSourceGuard({
  title: 'round cap guard',
  scriptName: 'check-no-round-cap.mjs',
  sourceRel: 'src/core/backends/modelapi/ModelApiHost.ts',
  tag: 'round-cap-guard',
  plantSnippet: '\n// planted round cap\nconst modelCallLimit = MODEL_API_MAX_TOOL_ROUNDS\n',
  plantMessage: 'MODEL_API_MAX_TOOL_ROUNDS still caps the turn',
  passMessage: 'no cap ok',
})
