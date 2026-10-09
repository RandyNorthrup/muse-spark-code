import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { LspServices } from '../../src/runtime/lsp/server'
import { runLsp } from '../../src/runtime/lsp/lspEntry'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { GitExitError } from '../../src/host/git'
import { UI_TEXT } from '../../src/shared/constants'
import { initialize, lspHarness } from './helpers/lspClient'
import { removeFolder } from './helpers/temporaryFolders'
import { pathToFileURL } from 'node:url'

const broker = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('../../src/runtime/lsp/broker', () => ({ startWorkspaceBroker: broker.start }))
const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-lsp-consent-')))
afterAll(() => removeFolder(folder))

describe('M104L connection Tab consent', () => {
  it.each(['deny', 'dismiss'])(
    'snoozes %s only for that editor connection without accessing a key',
    async (answer) => {
      const ready = Promise.withResolvers<LspServices>()
      const ending = Promise.withResolvers<undefined>()
      broker.start.mockImplementation(
        (_registry: string, _workspace: string, _configuration: string, services: LspServices) => {
          ready.resolve(services)
          return Promise.resolve({ closed: ending.promise })
        },
      )
      const file = path.join(folder, `${answer}.ts`)
      await writeFile(file, 'const value = ')
      const command = parseCommandLine([
        'lsp',
        '--workspace',
        folder,
        '--broker-worker',
        '--tab',
        '--trust-workspace',
      ])
      if (command.command !== 'lsp') throw new Error('fixture argv')
      const get = vi.fn(() => Promise.resolve(undefined))
      const done = runLsp(command.options, {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        executable: process.execPath,
        entry: 'unused',
        registry: path.join(folder, 'owners'),
        dataFolder: folder,
        grantsFile: path.join(folder, 'grants.json'),
        secrets: { get, store: vi.fn(), delete: vi.fn() },
        env: {},
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
        table: UI_TEXT,
        locale: 'en',
        runGit: () => Promise.reject(new GitExitError(1, '', 'check-ignore')),
      })
      const services = await ready.promise
      const clients = [lspHarness(folder, services), lspHarness(folder, services)]
      const prompts = [vi.fn(), vi.fn()]
      try {
        for (const [index, run] of clients.entries()) {
          run.answer((message, client) => {
            if (
              message.method !== 'window/showMessageRequest' ||
              message.id === undefined ||
              message.id === null
            )
              return
            prompts[index]?.()
            client.reply(message.id, answer === 'deny' ? { title: UI_TEXT.paidDeny } : null)
          })
          await initialize(run.client)
          const uri = pathToFileURL(file).href
          run.client.notify('textDocument/didOpen', {
            textDocument: { uri, version: 1, languageId: 'typescript', text: 'const value = ' },
          })
          const request = { textDocument: { uri }, position: { line: 0, character: 14 } }
          for (let attempt = 0; attempt < 2; attempt += 1)
            expect(await run.client.request('textDocument/completion', request)).toEqual([])
          expect(prompts[index]).toHaveBeenCalledTimes(1)
        }
        expect(get).not.toHaveBeenCalled()
      } finally {
        for (const run of clients) run.close()
        ending.resolve(undefined)
        await done
        broker.start.mockReset()
      }
    },
  )
})
