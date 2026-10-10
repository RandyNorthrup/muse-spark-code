import type * as ResourceAdmission from '../../../../src/core/resources/admission'
import type * as ResourceLauncher from '../../../../src/core/resources/launcher'
import { fixtureResourceCommand } from '../resourceProcess'
import { fakeResourceLease } from './fakes'

// Every governed launch is refused with "Resource admission unavailable" until
// the window or runtime configures its resources: that is the production
// answer for an unconfigured embedding, so a suite that does real OS work
// without configuring them picks one of these fixtures from a vi.mock factory.
// Admission itself (pause, cancel, dispose, containment) is proved by
// spawnBootstrap, spawnGovernance and spawnRuntimeAdmission.

/**
 * Suites that build real Windows job helpers: bootstrap admission grants a
 * fake lease, and the real bootstrap runner (bootstrapCommand → launcher →
 * process.ts) still spawns the compiler.
 *
 *   vi.mock('../../src/core/resources/admission', async (original) => {
 *     const { withFixtureBootstrap } = await import('./helpers/resources/fixtureLaunch')
 *     return withFixtureBootstrap(await original())
 *   })
 */
export function withFixtureBootstrap(actual: typeof ResourceAdmission): typeof ResourceAdmission {
  return { ...actual, admitBootstrap: () => Promise.resolve(fakeResourceLease()) }
}

/**
 * Suites whose bounded OS probes (process identity, Git metadata) are not the
 * subject: a direct bounded execFile replaces the governed command, which on
 * Windows would otherwise need the native job helper too.
 *
 *   vi.mock('../../src/core/resources/launcher', async (original) => {
 *     const { withFixtureCommand } = await import('./helpers/resources/fixtureLaunch')
 *     return withFixtureCommand(await original())
 *   })
 */
export function withFixtureCommand(actual: typeof ResourceLauncher): typeof ResourceLauncher {
  return { ...actual, execResourceFile: fixtureResourceCommand }
}
