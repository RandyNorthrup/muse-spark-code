import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runtimeAcpSharing,
  runtimeSharingConfidential,
} from '../../src/runtime/sharing/sharingEntry'
import { EN } from '../../src/shared/l10n/en'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
describe('M118 production runtime bindings', () => {
  it('saves verbatim personal prompts, lists and prepares them in a new workspace without backend reads', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'm118-runtime-'))
    roots.push(root)
    const read = vi.fn(() => Promise.reject(new Error('backend must not start')))
    const port = runtimeAcpSharing(
      {
        folders: {
          platform: process.platform,
          homeDir: root,
          env: { XDG_DATA_HOME: root, LOCALAPPDATA: root },
        },
        read,
      },
      EN,
      'en',
    )
    const context = {
      cwd: path.join(root, 'first'),
      sessionId: 's1',
      isActive: () => true,
      signal: new AbortController().signal,
    }
    const saved = await port.execute(
      '/prompt save --title Example --scope user --   Exact\r\nbody  ',
      context,
    )
    const id = /\(([^()]*)\)$/.exec(saved)?.[1]
    expect(id).toBeDefined()
    const fresh = { ...context, cwd: path.join(root, 'empty') }
    expect(await port.execute('/prompt list', fresh)).toContain('Example')
    expect(await port.execute(`/prompt use ${id ?? ''}`, fresh)).toContain('  Exact\r\nbody  ')
    expect(await port.execute('/help', fresh)).toContain('/share chat')
    expect(read).not.toHaveBeenCalled()
  })
  it('refuses unknown confidential policy and respects explicit workspace settings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'm118-policy-'))
    roots.push(root)
    expect(runtimeSharingConfidential(root)).toBe(false)
    await mkdir(path.join(root, '.vscode'))
    const file = path.join(root, '.vscode', 'settings.json')
    await writeFile(file, '{"museSpark.confidentialWorkspace":true}')
    expect(runtimeSharingConfidential(root)).toBe(true)
    await writeFile(file, '{broken')
    expect(runtimeSharingConfidential(root)).toBeUndefined()
  })
})
