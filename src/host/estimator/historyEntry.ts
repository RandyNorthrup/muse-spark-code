// The estimator history's journal as a first-use bundle of its own (M117
// C-M117-2, PLAN.md D6): esbuild builds this into dist/estimateHistory.js,
// required the first time an estimate reads its history. The journal and its
// record rules stay out of activation, and the engine bundle keeps its own
// budget.
export { fileHistoryPorts } from './historyStore'
