// Start real Chrome once, before test workers compete for hosted CPUs. Each
// suite connects separately and owns isolated contexts; no profile is shared.
// The Playwright server runs in reviewBrowserServer.mjs's own process, not in
// vitest's main process, whose event loop also transforms every worker's
// modules (CIFIX017R3).
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export const REVIEW_BROWSER_KEY = 'reviewBrowser'
export const REVIEW_RASTERIZATION_KEY = 'reviewRasterization'
const suites = [
  '/visualReadiness.test.mjs',
  '/visualStability.test.mjs',
  '/m114ConversationReview.test.mjs',
]

async function firstLine(child, exited) {
  const lines = createInterface({ input: child.stdout })
  const started = (async () => {
    const [line] = await once(lines, 'line')
    return line
  })()
  const ended = (async () => {
    await exited
    return null
  })()
  const line = await Promise.race([started, ended])
  if (line === null) throw new Error('Review browser server exited before it started')
  return line
}

export async function startReviewBrowser(project, files) {
  if (files.every((file) => suites.every((suite) => !file.replaceAll('\\', '/').endsWith(suite))))
    return
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('reviewBrowserServer.mjs', import.meta.url))],
    { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true },
  )
  const exited = once(child, 'exit')
  // Ending stdin closes the server, its connections and Chrome.
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.stdin.end()
    await exited
  }
  try {
    const { endpoint, rasterization } = JSON.parse(await firstLine(child, exited))
    project.provide(REVIEW_RASTERIZATION_KEY, rasterization)
    project.provide(REVIEW_BROWSER_KEY, endpoint)
  } catch (error) {
    await close()
    throw error
  }
  return { close }
}
