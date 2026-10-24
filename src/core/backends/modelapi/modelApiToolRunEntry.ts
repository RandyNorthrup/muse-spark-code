// What a tool call or goal command runs (PLAN.md D6), built as
// dist/modelApiToolRun.js and loaded on the first of them: the file and
// shell tools' execution (with the byte-range and search helpers they load
// in turn), the memory tool's placing and running, the browser check's
// placement, scope and report, and the goal tools' and commands' rules.
// dist/modelApi.js keeps the tool list, the permission classes, the shell
// output's shaping and every check before a card, and requires this entry
// for the run itself. The bundle keeps its own installed-language state, so
// the session installs the caller's table before use. A bundle that cannot
// load fails the call that needed it, never a default outcome.
export { executeTool } from './tools'
export { placeMemoryCall, runMemoryCall } from './memoryTools'
export {
  browserCheckScope,
  browserScopeKey,
  extraHostSet,
  placeBrowserCall,
} from '../../browser/browserTool'
export { browserCheckOutcome, browserCheckRefused } from './browserCalls'
export { applyGoalCommand, goalObjectiveProblem, runGoalTool } from './goals'
// The file tools' edit helpers, read from here by the byte-range execution
// (dist/modelApiFileRange.js), which loads only from this chunk.
export * from '../../toolEdit'
export { setUiText } from '../../../shared/l10n/text'
