// POSTSPAWN: the governed launcher (profiles, the attested Windows job,
// bounded commands and hand-offs) loads in its own first-use bundle,
// dist/resourceProcess.js. The governor's policy bundle never carries it (the
// split gate's RESOURCE_PROCESS_ONLY), so neither outgrows its cap with the
// other's code. The runtime's Windows helper preparation is a client of this
// launcher (its compiles are bootstrap launches), so it ships with the runtime
// instead (src/runtime/resources/jobs.ts), outside this module's graph.
export { spawnResourceProcess } from './process'
export { execResourceFile, handoffResourceFile } from './commands'
