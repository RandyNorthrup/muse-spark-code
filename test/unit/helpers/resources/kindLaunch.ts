import type * as ResourceLauncher from '../../../../src/core/resources/launcher'
import { fixtureResourceCommand } from '../kindResourceProcess'

// Every governed launch is refused with "Resource admission unavailable" until
// the window or runtime configures its resources: that is the production
// answer for an unconfigured embedding, so a suite that does real OS work
// without configuring them picks one of these fixtures from a vi.mock factory.
// Admission itself (pause, cancel, dispose, containment) is proved by
// spawnBootstrap, spawnGovernance and spawnRuntimeAdmission.

/**
 * Suites whose bounded OS probes (process identity, Git metadata) are not the
 * subject: a direct bounded execFile replaces the governed command, which on
 * Windows would otherwise need the native job helper too.
 *
 *   vi.mock('../../src/core/resources/launcher', async (original) => {
 *     const { withFixtureCommand } = await import('./helpers/resources/kindLaunch')
 *     return withFixtureCommand(await original())
 *   })
 */
export function withFixtureCommand(actual: typeof ResourceLauncher): typeof ResourceLauncher {
  return { ...actual, execResourceFile: fixtureResourceCommand }
}
