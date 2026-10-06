import { spawn } from 'node:child_process'
import { mkdtemp, realpath, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { lspTransport } from '../../src/runtime/lsp/transport'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { initialize } from './helpers/lspClient'
import { removeFolder } from './helpers/temporaryFolders'

const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'mlf-')))
const entry = path.join(folder, 'entry.js')
await build({
  entryPoints: ['test/unit/helpers/runtimeLspParent.ts'],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'silent',
})
await build({
  entryPoints: ['src/runtime/lsp/watchdogEntry.ts'],
  outfile: path.join(folder, 'watchdog.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'silent',
})
afterAll(() => removeFolder(folder))

function child(args: readonly string[]) {
  return spawn(process.execPath, [entry, ...args], {
    cwd: folder,
    env: withoutCredentials(process.env),
    stdio: 'pipe',
  })
}
function closed(process: ReturnType<typeof child>) {
  return new Promise<number | null>((resolve) => {
    process.once('close', resolve)
  })
}

describe('M104L real runtime factory without paid flags', () => {
  it('starts one detached supervised broker for two stdio frontends, then independent Stop exits both', async () => {
    const first = child(['lsp', '--workspace', folder, '--trust-workspace'])
    const second = child(['lsp', '--workspace', folder, '--trust-workspace'])
    const firstClosed = closed(first)
    const secondClosed = closed(second)
    const clients = [first, second].map((process) =>
      lspTransport(process.stdout, process.stdin, vi.fn()),
    )
    try {
      for (const client of clients)
        expect(await initialize(client)).toMatchObject({
          capabilities: { codeActionProvider: false },
        })
      const owners = await readdir(path.join(folder, 'owners'))
      expect(owners.filter((file) => file.endsWith('.json'))).toHaveLength(1)
      expect(
        await clients[0]?.request('workspace/executeCommand', { command: 'muse.usage' }),
      ).toMatchObject({ paid: true, totalUsd: 0, budgetUsd: 1 })
      const file = path.join(folder, 'sample.ts')
      await writeFile(file, 'const a = ')
      const uri = pathToFileURL(file).href
      clients[0]?.notify('textDocument/didOpen', {
        textDocument: { uri, version: 1, languageId: 'typescript', text: 'const a = ' },
      })
      expect(
        await clients[0]?.request('textDocument/completion', {
          textDocument: { uri },
          position: { line: 0, character: 10 },
          context: { triggerKind: 1 },
        }),
      ).toEqual([])
      await expect(
        clients[1]?.request('workspace/executeCommand', { command: 'muse.openPanel' }),
      ).rejects.toThrow('ELSP_CLIENT')
      const stop = child(['stop'])
      const result = await closed(stop)
      expect(result).toBe(0)
      expect(await firstClosed).toBe(0)
      expect(await secondClosed).toBe(0)
    } finally {
      for (const client of clients) client.close()
      first.kill('SIGKILL')
      second.kill('SIGKILL')
      const stop = child(['stop'])
      await closed(stop)
    }
  })
})
