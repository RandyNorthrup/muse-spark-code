// The verify loop's session side (M68, PLAN.md D49), built as
// dist/modelApiVerify.js and loaded on the first turn that verifies tool
// edits. dist/modelApi.js keeps the loop's drivers (the check runner, the
// then_run guard, the schedules context that carries its section reader)
// and requires this entry for the loop itself, its ledger and the
// diagnostics history. A bundle that cannot load fails the turn or check
// run that needed it, never a silent skip and never a default.
export { VerifyLedger, type CheckScope, type RunSnapshot } from './verifyLedger'
export {
  authorizeThenGuard,
  checksSection,
  finishedCheck,
  outcomeOf,
  skippedCheck,
  skipReason,
  type CheckRun,
  type Refusal,
  type VerifyHooks,
} from './verifyLoop'
export {
  DiagnosticsHistory,
  clipText,
  type DiagnosticsReport,
  type EditedFile,
  type FileDiagnostics,
  type PendingReport,
  type ReportOptions,
} from '../../verify/diagnosticsReport'
