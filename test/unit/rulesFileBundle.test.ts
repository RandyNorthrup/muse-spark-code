// The Create AGENTS.md command's lazy bundle: the loader refuses anything
// but the entry's shape, and the entry creates the file through the real
// command over a real temporary workspace.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isRulesFileBundle, loadRulesFileBundle } from '../../src/host/commands/rulesFileBundle'
import * as entry from '../../src/host/commands/rulesFileEntry'
import type { CreateRulesFileDeps } from '../../src/host/commands/createRulesFile'
import { EN } from '../../src/shared/l10n/en'
import { recordLogger } from './helpers/recordLogger'

const folders: string[] = []
afterEach(() => {
  while (folders.length > 0) rmSync(folders.pop()!, { recursive: true, force: true })
})

function workspace(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'rules-file-'))
  folders.push(folder)
  return folder
}

function deps(
  workspaceRoot: string | undefined,
  runInit: CreateRulesFileDeps['runInit'],
): {
  deps: CreateRulesFileDeps
  shown: string[]
  opened: string[]
  logged: string[]
} {
  const shown: string[] = []
  const opened: string[] = []
  const { log, logged } = recordLogger()
  return {
    logged,
    deps: {
      workspaceRoot,
      isWorkspaceTrusted: () => true,
      fileExists: (fsPath) => {
        try {
          readFileSync(fsPath)
          return Promise.resolve(true)
        } catch {
          return Promise.resolve(false)
        }
      },
      writeFile: (fsPath, content) => {
        writeFileSync(fsPath, content)
        return Promise.resolve()
      },
      openFile: (fsPath) => {
        opened.push(fsPath)
        return Promise.resolve()
      },
      runInit,
      showInformation: (message) => {
        shown.push(message)
      },
      showWarning: (message) => {
        shown.push(message)
      },
      log,
    },
    shown,
    opened,
  }
}

describe('loadRulesFileBundle', () => {
  it('loads the entry and creates the template when the CLI is absent', async () => {
    const root = workspace()
    const { deps: commandDeps, shown, opened } = deps(root, () => undefined)
    const bundle = loadRulesFileBundle('dist/rulesFile.js', () => entry)
    expect(bundle).toBeDefined()
    await bundle.createRulesFile(commandDeps, EN, 'en')
    const target = path.join(root, 'AGENTS.md')
    expect(readFileSync(target, 'utf8')).toContain('AGENTS.md')
    expect(opened).toEqual([target])
    expect(shown.some((message) => message.includes('created'))).toBe(true)
  })

  it('opens the existing file without writing', async () => {
    const root = workspace()
    const target = path.join(root, 'AGENTS.md')
    writeFileSync(target, 'existing rules')
    const { deps: commandDeps, shown } = deps(root, () => undefined)
    const bundle = loadRulesFileBundle('dist/rulesFile.js', () => entry)
    await bundle.createRulesFile(commandDeps, EN, 'en')
    expect(readFileSync(target, 'utf8')).toBe('existing rules')
    expect(shown.some((message) => message.includes('already exists'))).toBe(true)
  })

  it('keeps the file the CLI wrote', async () => {
    const root = workspace()
    const target = path.join(root, 'AGENTS.md')
    const { deps: commandDeps, opened } = deps(root, () => {
      writeFileSync(target, 'from muse init')
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    })
    const bundle = loadRulesFileBundle('dist/rulesFile.js', () => entry)
    await bundle.createRulesFile(commandDeps, EN, 'en')
    expect(readFileSync(target, 'utf8')).toBe('from muse init')
    expect(opened).toEqual([target])
  })

  it('falls back to the template when the CLI fails', async () => {
    const root = workspace()
    const { deps: commandDeps, logged } = deps(root, () =>
      Promise.resolve({ exitCode: 1, stdout: '', stderr: 'boom' }),
    )
    const bundle = loadRulesFileBundle('dist/rulesFile.js', () => entry)
    await bundle.createRulesFile(commandDeps, EN, 'en')
    const target = path.join(root, 'AGENTS.md')
    expect(readFileSync(target, 'utf8')).toContain('AGENTS.md')
    expect(logged.some((line) => line.startsWith('warn:') && line.includes('exited 1'))).toBe(true)
  })

  it('warns without a workspace', async () => {
    const { deps: commandDeps, shown } = deps(undefined, () => undefined)
    const bundle = loadRulesFileBundle('dist/rulesFile.js', () => entry)
    await bundle.createRulesFile(commandDeps, EN, 'en')
    expect(shown.some((message) => message.includes('folder'))).toBe(true)
  })

  it('refuses a wrong-shaped module and a failed load, naming the cause', () => {
    expect(() => loadRulesFileBundle('dist/rulesFile.js', () => ({}))).toThrow(
      'dist/rulesFile.js is not the Create AGENTS.md command bundle',
    )
    expect(() => loadRulesFileBundle('dist/rulesFile.js', () => ({ createRulesFile: 42 }))).toThrow(
      'is not the Create AGENTS.md command bundle',
    )
    expect(() =>
      loadRulesFileBundle('dist/rulesFile.js', () => {
        throw new Error('ENOENT: no such file')
      }),
    ).toThrow('dist/rulesFile.js could not be loaded: ENOENT: no such file')
    expect(isRulesFileBundle(entry)).toBe(true)
    expect(isRulesFileBundle(undefined)).toBe(false)
  })
})
