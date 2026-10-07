import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildNodeWorkspace } from '../harness/build-node.mjs'
import type { Metafile } from 'esbuild'

const built: { directory: string; meta?: Metafile; error?: unknown } = { directory: '' }
beforeAll(async () => {
  built.directory = await mkdtemp(path.join(tmpdir(), 'm110-u1-build-'))
  const temporary = path.resolve('temp/u1-deps/node_modules')
  try {
    built.meta = await buildNodeWorkspace(
      built.directory,
      existsSync(temporary) ? temporary : undefined,
    )
  } catch (error: unknown) {
    built.error = error
  }
})
afterAll(async () => {
  if (built.directory !== '') await rm(built.directory, { recursive: true, force: true })
})
describe('M110-U1 independent browser budget', () => {
  it('H09 enforces the workspace and editor caps with the actual CodeMirror merge bundle', () => {
    expect(built.error).toBeUndefined()
    expect(built.meta).toBeDefined()
    const inputs = Object.keys(built.meta?.inputs ?? {}).map((name) => name.replaceAll('\\', '/'))
    expect(inputs.some((name) => name.includes('/@codemirror/merge/'))).toBe(true)
    expect(inputs.some((name) => /\/(?:codemirror|@codemirror\/[^/]+)\/.*\.cjs$/u.test(name))).toBe(
      false,
    )
    expect(inputs.some((name) => name.endsWith('/vscode.js'))).toBe(false)
  })
  it('carries the exact shipped dependency licences beside the standalone chunks', async () => {
    const notices = await readFile(path.join(built.directory, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
    expect(notices).toContain('@codemirror/merge@6.12.2')
    expect(notices).toContain('codemirror@6.0.2')
    expect(notices).toContain('MIT')
  })
  it('keeps CodeMirror out of the independent workspace startup and loads it through a dynamic chunk', async () => {
    expect(built.error).toBeUndefined()
    const entries = Object.entries(built.meta?.outputs ?? {})
    const main = entries.find(
      ([, item]) => item.entryPoint?.replaceAll('\\', '/') === 'src/webview/node/files/main.tsx',
    )
    expect(main).toBeDefined()
    if (main === undefined) throw new Error('no workspace entry')
    const text = await readFile(main[0], 'utf8')
    expect(text).not.toContain('cm-mergeViewEditors')
    expect(
      entries.some(([, item]) => item.imports.some((entry) => entry.kind === 'dynamic-import')),
    ).toBe(true)
    expect(
      entries.some(([, item]) =>
        Object.keys(item.inputs).some((input) =>
          input.replaceAll('\\', '/').includes('/@codemirror/merge/'),
        ),
      ),
    ).toBe(true)
  })
})
