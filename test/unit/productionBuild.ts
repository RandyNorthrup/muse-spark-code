// Vitest global setup (M100 join, the Windows harness budget): builds the
// production bundles once per test run, before any test file starts and
// outside every hook's deadline, when the run includes a suite that serves
// them from dist/. Those suites check for this shared build in their
// preparation instead of rebuilding, so their named preparation budget covers
// only their own server and browser, and two suites never write dist/ at once.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

/** The suites that serve the production build from dist/. */
const PRODUCTION_BUILD_SUITES: ReadonlySet<string> = new Set([
  'test/unit/devicesPhase2Harness.test.mjs',
  'test/unit/teamHarness.test.mjs',
])
// A hung build fails the run with its output instead of holding it open.
const PRODUCTION_BUILD_TIMEOUT_MS = 600_000

declare module 'vitest' {
  export interface ProvidedContext {
    /** This run built the production bundles before its first file started. */
    productionBuild: boolean
  }
}

/** Whether any selected test file serves the production build. */
export function requiresProductionBuild(root: string, selected: readonly string[]): boolean {
  return selected.some((file) =>
    PRODUCTION_BUILD_SUITES.has(path.relative(root, file).replaceAll('\\', '/')),
  )
}

export default function setup(project: TestProject): void {
  const root = project.config.root
  // The run's selected files (the state API is experimental: a change there
  // shows as the serving suites' own refusal below, never a silent skip).
  const isNeeded = requiresProductionBuild(root, project.vitest.state.getPaths())
  if (isNeeded)
    execFileSync(process.execPath, ['scripts/build.mjs', '--production'], {
      cwd: root,
      stdio: 'pipe',
      timeout: PRODUCTION_BUILD_TIMEOUT_MS,
    })
  project.provide('productionBuild', isNeeded)
}
