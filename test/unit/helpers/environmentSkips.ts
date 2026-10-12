/**
 * Suites gated by `runIf`/`skipIf` on an installed tool. Every entry names
 * the suite, its file, the tool, and the SAME detector the suite's own
 * condition calls, so the list cannot drift from what the suite probes. The
 * audit test asserts that every tool-gated suite in the tree is registered
 * here, and that the set skipping on a machine equals the expected list for
 * its platform: a suite cannot start (or stop) skipping unnoticed.
 *
 * Not here on purpose: suites gated by opt-in env vars (the live drills,
 * browserCheckLive's storage/address probes), by platform (Windows-only,
 * macOS-only, volume case-sensitivity), or by a live probe with its own
 * timeout (runnerHelperNative's pwsh spawn check).
 */
import { findBash, windowsPowerShell } from './shellParsers'
import { bunPath, hasPluginNode } from './realMachine'

export interface EnvironmentGatedSuite {
  readonly suite: string
  readonly file: string
  readonly tool: string
  readonly present: () => boolean
}

export const ENVIRONMENT_GATED_SUITES: readonly EnvironmentGatedSuite[] = [
  {
    suite: 'OpenCode under the installed bun, bounded by prlimit (P2 12)',
    file: 'test/unit/pluginDispatch.test.ts',
    tool: 'bun',
    present: () => bunPath() !== undefined,
  },
  {
    suite: 'the PowerShell table against 5.1’s own parser (M78)',
    file: 'test/unit/shellSyntax.test.ts',
    tool: 'Windows PowerShell 5.1',
    present: () => windowsPowerShell() !== undefined,
  },
  {
    suite: 'the bash table against bash itself (M78)',
    file: 'test/unit/shellSyntax.test.ts',
    tool: 'bash',
    present: () => findBash() !== undefined,
  },
  {
    suite: 'passes a required name only when its whole tier succeeded',
    file: 'test/unit/manifest.test.ts',
    tool: 'bash',
    present: () => findBash() !== undefined,
  },
  {
    suite: 'plugin hooks in a Model API session (M91b)',
    file: 'test/unit/modelApiForeignHooks.test.ts',
    tool: 'a supported Node.js (22.18+) off Windows',
    present: hasPluginNode,
  },
]

/**
 * The registered suites expected to skip on each platform, verified on
 * Linux (this rig and CI: no bun, no PowerShell 5.1); win32 and darwin from
 * the detectors' code, for the lead to confirm on those hosts. A machine
 * that gains or loses a tool fails the audit until this list is blessed.
 */
export const EXPECTED_ENVIRONMENT_SKIPS: Record<string, readonly string[]> = {
  linux: [
    'OpenCode under the installed bun, bounded by prlimit (P2 12)',
    'the PowerShell table against 5.1’s own parser (M78)',
  ],
  darwin: [
    'OpenCode under the installed bun, bounded by prlimit (P2 12)',
    'the PowerShell table against 5.1’s own parser (M78)',
  ],
  win32: [
    'OpenCode under the installed bun, bounded by prlimit (P2 12)',
    'plugin hooks in a Model API session (M91b)',
  ],
}
