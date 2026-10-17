// The Amp and OpenCode plugin host's own bundle (M91b, PLAN.md D6):
// dist/pluginHooks.js, which foreignHooksEntry requires the first time a
// session dispatches a plugin hook. It carries the child's source, the host
// that runs it in a contained tree, and the event mapping, so neither the
// imported hooks' adapters (dist/foreignHooks.js) nor anything earlier loads
// them.

export { pluginAnswer, pluginRequest } from './pluginFormats'
export { containedTree, PluginSession } from './pluginHost'
