// Fake-only race gates for the broker startup tests: a flag box plus a chmod
// gate that holds the permission-fix window open, so a server failure can be
// fired into it deterministically. The fake server class itself lives in the
// test file's node:net mock factory (built on the real Server); this module
// keeps only types and state, so it never imports the mocked graph back.
// No credential or model access.
import type { Server } from 'node:net'

/**
 * A broker socket server stand-in: a real but never-bound server behind a
 * proxy that records the bound state, so the test (not the kernel) reports
 * readiness and failures without a socket. Emitting a test failure only
 * records the listener count when no handler is subscribed, so a missed
 * subscription fails the test instead of crashing the worker.
 */
export interface FakeBrokerServer {
  readonly server: Server
  /** Report readiness the way a successful kernel bind would. */
  notifyListening(): void
  /**
   * Fire a server failure. Returns the subscribed error-listener count so the
   * test can assert the shutdown handler was already installed.
   */
  emitTestError(error: Error): number
}

export const brokerRaceGates = {
  fakeServer: false,
  servers: [] as FakeBrokerServer[],
  chmodGated: false,
  chmodEntered: false,
  releaseChmod: (): void => undefined,
  reset(): void {
    brokerRaceGates.fakeServer = false
    brokerRaceGates.servers.length = 0
    brokerRaceGates.chmodGated = false
    brokerRaceGates.chmodEntered = false
    brokerRaceGates.releaseChmod = (): void => undefined
  },
}

/**
 * The broker's socket permission fix, held open while the race test fires a
 * server failure into the window. Ungated calls (every other test) run the
 * real chmod; the gated call resolves without touching the filesystem because
 * the fake server bound no socket file.
 */
export async function gatedChmod(real: () => Promise<void>): Promise<void> {
  if (!brokerRaceGates.chmodGated) {
    await real()
    return
  }
  brokerRaceGates.chmodEntered = true
  await new Promise<void>((resolve) => {
    brokerRaceGates.releaseChmod = resolve
  })
}
