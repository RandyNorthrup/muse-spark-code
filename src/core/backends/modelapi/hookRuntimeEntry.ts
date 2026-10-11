// The Model API backend's hook and MCP-form runtime (M91, PLAN.md D6), in a
// bundle of its own (dist/hookRuntime.js) that a session loads the first time
// it needs one of these, so dist/modelApi.js stays within its budget:
//
// - lane E's spark-hooks.json reader and its extension-event dispatcher;
// - lane H's typed handlers (http, mcp_tool, prompt and agent);
// - lane M's checks on an MCP server's form request and on the answer to it;
//
// It loads only when a spark-hooks.json exists, a typed handler runs or a
// server asks for a form, or a session is imported. dist/modelApi.js
// keeps the modules' types, field builders and constants; esbuild leaves out
// what only this entry reaches.

export { dispatchExtensionHooks, loadSparkHookDefinitions } from './extensionHooks'
export { runTypedHandler } from './hookHandlers'
export {
  checkElicitationOutcome,
  parseElicitationParams,
  validateElicitationSchema,
  validateElicitationValues,
} from './mcp/elicitation'
