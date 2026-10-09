import { spawn } from 'node:child_process'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'
import { lspTransport } from '../../src/runtime/lsp/transport'
import { initialize } from './helpers/lspClient'
import { removeFolder } from './helpers/temporaryFolders'

const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-lsp-stdio-')))
const file = path.join(folder, 'fake.js')
await build({
  entryPoints: ['test/unit/helpers/fakeLsp.ts'],
  outfile: file,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'silent',
})
afterAll(() => removeFolder(folder))

describe('M104L scripted client over real stdio', () => {
  it.each([false, true])(
    'completes negotiated inline=%s Unicode exchange and stops during a blocked request',
    async (isInline) => {
      const child = spawn(process.execPath, [file], { cwd: folder, stdio: 'pipe' })
      const client = lspTransport(child.stdout, child.stdin, () => {
        /* Fixture emits no client requests. */
      })
      const closed = new Promise<void>((resolve) => {
        child.once('close', () => {
          resolve()
        })
      })
      const uri = pathToFileURL(path.join(folder, 'file.ts')).href
      try {
        await initialize(client, isInline)
        client.notify('textDocument/didOpen', {
          textDocument: { uri, version: 1, languageId: 'typescript', text: '🙂' },
        })
        const method = isInline ? 'textDocument/inlineCompletion' : 'textDocument/completion'
        const answer = await client.request(method, {
          textDocument: { uri },
          position: { line: 0, character: 2 },
        })
        expect(answer).toMatchObject(
          isInline
            ? { items: [{ insertText: 'completion🙂' }] }
            : [{ textEdit: { newText: 'completion🙂' } }],
        )
        client.notify('textDocument/didChange', {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: 'busy' }],
        })
        const pending = client.request(method, {
          textDocument: { uri },
          position: { line: 0, character: 2 },
        })
        void pending.catch(() => {
          /* The cancellation is asserted below. */
        })
        expect(await client.request('workspace/executeCommand', { command: 'muse.stop' })).toEqual({
          command: 'muse.stop',
        })
        // The scripted client's first three calls consumed server-1 through server-3.
        client.notify('$/cancelRequest', { id: 'server-3' })
        await expect(pending).rejects.toMatchObject({ message: 'ELSP_CLIENT', cause: -32_800 })
        expect(await client.request('shutdown', {})).toBeNull()
        client.notify('exit', {})
        await closed
        expect(child.exitCode).toBe(0)
      } finally {
        client.close()
        child.kill('SIGKILL')
      }
    },
  )
})
