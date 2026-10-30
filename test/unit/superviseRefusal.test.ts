// RLF-LSPBUS: `supervise` and `stop` refuse when their records cannot be
// kept in a folder only the person can write to. The refusal is by design
// (the records carry each run's stop token); what the person must get is a
// sentence naming the problem and the remedy, never a bare failure. Driven
// through the real entry functions on a real folder made writable by
// others, which the real private-root check refuses on POSIX.
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { runStop, runSupervise } from '../../src/runtime/supervise/superviseEntry'
import { CLI_EXIT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'

const FOLDER = await mkdtemp(path.join(tmpdir(), 'muse-supervise-refusal-'))
const DATA_FOLDER = path.join(FOLDER, 'data')

afterAll(async () => {
  await rm(FOLDER, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')(
  'supervision refusals on a data folder others can write',
  () => {
    it('stop prints why it cannot use the records folder and exits failed', async () => {
      await chmod(FOLDER, 0o777)
      const printed: string[] = []
      const logged: string[] = []
      const code = await runStop({
        dataFolder: DATA_FOLDER,
        cwd: FOLDER,
        env: process.env,
        table: EN,
        locale: 'en',
        log: stderrLogger((line) => {
          logged.push(line)
        }, 'trace'),
        print: (line) => {
          printed.push(line)
        },
      })
      expect(code).toBe(CLI_EXIT.failure)
      expect(printed).toEqual([EN.supervision.recordsFolderNotPrivate])
      expect(logged).toEqual([])
    })

    it('supervise logs why it cannot start and exits failed, spawning nothing', async () => {
      await chmod(FOLDER, 0o777)
      const logged: string[] = []
      const code = await runSupervise(['lsp', '--workspace', FOLDER], {
        dataFolder: DATA_FOLDER,
        cwd: FOLDER,
        env: process.env,
        table: EN,
        locale: 'en',
        log: stderrLogger((line) => {
          logged.push(line)
        }, 'trace'),
        entry: fileURLToPath(import.meta.url),
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      })
      expect(code).toBe(CLI_EXIT.failure)
      expect(logged).toContain(`[error] ${EN.supervision.recordsFolderNotPrivate}`)
    })
  },
)
