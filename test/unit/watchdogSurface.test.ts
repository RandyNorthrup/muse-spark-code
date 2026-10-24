// The watchdog's bound surface and bundle entry over real folders: the
// store binds under a scratch data folder without GitHub and without the
// credential store, the entry's CLI routes through, and a missing bundle
// answers unavailable at the ACP layer.
import { describe, expect, it } from 'vitest'
import { acpWatchdog, type AcpWatchdogBundle } from '../../src/acp/watchdog'
import { requireFile } from '../../src/host/lazyBundle'
import {
  createWatchdogSurface as entryCreateWatchdogSurface,
  runWatchdogCli as entryRunWatchdogCli,
} from '../../src/runtime/watchdog/watchdogEntry'
import type { WatchdogSurfacePort } from '../../src/runtime/watchdog/command'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { collectingLogger } from './helpers/collectingLogger'
import { fileRoots } from './helpers/tempDirs'
import { WATCHDOG_REPOSITORY } from './helpers/watchdog/fixtures'

const roots = fileRoots()

async function boundSurface(prefix: string, logged: string[]): Promise<WatchdogSurfacePort> {
  const folder = await roots.fresh(prefix)
  return await entryCreateWatchdogSurface(
    {
      log: collectingLogger(logged),
      dataFolder: folder,
      userAgent: 'muse-spark-code/test',
      secrets: undefined,
    },
    UI_TEXT,
    'en',
  )
}

describe('watchdog surface and bundle entry', () => {
  it('binds a working store without GitHub and without the credential store', async () => {
    const logged: string[] = []
    const port = await boundSurface('watchdog-surface-', logged)
    expect(port.client).toBeUndefined()
    expect(port.token).toBeUndefined()
    expect(typeof port.now()).toBe('number')
    expect(port.newRunId()).not.toBe(port.newRunId())
    // The store round-trips through the real journal.
    await port.store.exclusive(WATCHDOG_REPOSITORY, (data) => ({ data, result: undefined }))
    const rows = await port.store.list()
    expect(rows.map((row) => row.policy.repository)).toEqual([WATCHDOG_REPOSITORY])
    expect(logged).toEqual([])
  })

  it('routes the CLI list through the entry', async () => {
    const port = await boundSurface('watchdog-surface-cli-', [])
    const stdout: string[] = []
    const stderr: string[] = []
    const code = await entryRunWatchdogCli(
      ['list'],
      {
        port,
        writeStdout: (text) => {
          stdout.push(text)
        },
        printError: (text) => {
          stderr.push(text)
        },
        log: collectingLogger([]),
      },
      UI_TEXT,
      'en',
    )
    expect(code).toBe(0)
    expect(stdout).toEqual([UI_TEXT.watchdog.cli.empty])
    expect(stderr).toEqual([])
  })

  it('a missing bundle stays unavailable at the ACP layer', async () => {
    const logged: string[] = []
    const missing = await acpWatchdog(
      [{ type: 'text' as const, text: '/watchdog list' }],
      () => Promise.resolve(undefined),
      () => requireFile('/nonexistent/acpWatchdog.js') as AcpWatchdogBundle,
      collectingLogger(logged),
    )
    expect(missing).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.unavailable })
    expect(logged.some((line) => line.includes('The watchdog surface is unavailable:'))).toBe(true)
  })
})
