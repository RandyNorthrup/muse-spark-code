// Shared by the ACP agent's suites: waiting on a condition the agent reaches
// asynchronously.

const POLL_MS = 5
const WAIT_MS = 2000

/** Resolves once `isMet` holds, polling; fails the test after two seconds. */
export async function until(isMet: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!isMet()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time')
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}
