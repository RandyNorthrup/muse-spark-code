// The Model API backend's command-policy bundle (PLAN.md D6): the shell
// reader and the command rules every shell line is judged with. esbuild builds
// this file into dist/modelApiShell.js; the backend's permission modules import
// these names, which the build externalises to a require of the sibling
// bundle. Neither module reads the installed language, so the bundle carries
// no language state. Every name read across the boundary is exported here.
export { commandShape } from './shellSyntax'
export { compileCommandRules, isEvaluator, judgeCommand } from './commandRules'
