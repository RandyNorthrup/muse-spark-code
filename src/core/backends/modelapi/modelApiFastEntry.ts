// The fast judge's session side (M125 lane M, PLAN.md D107), built as
// dist/modelApiFast.js and loaded when each turn or compaction starts,
// before its first request: the loop detector, the first-send triage, the
// effort and keep-list verdicts and the turn boundary with its tail notes.
// dist/modelApi.js keeps the switch, the pin, the finished turn's texts and
// the repeat guard's notice, and calls the loaded judge synchronously. A
// bundle that cannot load fails the turn or compaction that needed it,
// never a silent skip of a decision.
export {
  ModelApiFastJudge,
  type FastEffortRequest,
  type FastJudgeHost,
  type FastReplayEntry,
} from './fastJudge'
