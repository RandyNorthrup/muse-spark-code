// POSTSPAWN: the governed launcher (profiles, the attested Windows job,
// bounded commands and hand-offs) and the runtime's Windows helper
// preparation load in their own first-use bundle, dist/resourceProcess.js.
// The governor's policy bundle never carries them (the split gate's
// RESOURCE_PROCESS_ONLY), so neither outgrows its cap with the other's code.
export { spawnResourceProcess } from './process'
export { execResourceFile, handoffResourceFile } from './commands'
export { runtimeResourceJobs } from '../../runtime/resources/jobs'
