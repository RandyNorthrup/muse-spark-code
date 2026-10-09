import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { vscodeLanguageServices } from '../../../src/host/vscode/codeIntel/languageServices'

// Probed for a second writable drive and for a letter with nothing mounted.
const DRIVE_LETTERS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R']

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
afterEach(() => {
  if (platformDescriptor !== undefined)
    Object.defineProperty(process, 'platform', platformDescriptor)
  vi.mocked(vscode.commands.executeCommand).mockReset()
})

function item(name: string, path: string): vscode.CallHierarchyItem {
  const range = new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 2))
  return { name, kind: 11, uri: vscode.Uri.file(path), range, selectionRange: range }
}
async function selected(
  path: string,
  candidatePath: string,
  elsewhere = '/elsewhere.ts',
): Promise<string | undefined> {
  vi.mocked(vscode.commands.executeCommand)
    .mockResolvedValueOnce([item('elsewhere', elsewhere), item('declared', candidatePath)])
    .mockResolvedValueOnce([])
  const answer = await vscodeLanguageServices().callHierarchy(
    path,
    { line: 1, character: 1 },
    'incoming',
  )
  expect(answer?.otherItems).toBe(1)
  return answer?.item.name
}

describe('call-hierarchy resource identity on Windows', () => {
  it('skips a virtual provider item without treating it as a disk path', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const virtual = item('virtual', 'Untitled-1')
    // The central URI mock is file-only; this provider response is explicitly virtual.
    Object.defineProperty(virtual.uri, 'scheme', { value: 'untitled' })
    vi.mocked(vscode.commands.executeCommand)
      .mockResolvedValueOnce([virtual, item('declared', 'c:/FIXTURE/CALLS.ts')])
      .mockResolvedValueOnce([])
    const answer = await vscodeLanguageServices().callHierarchy(
      'C:/fixture/calls.ts',
      { line: 1, character: 1 },
      'incoming',
    )
    expect(answer?.item.name).toBe('declared')
  })

  it('matches native Windows separators before selecting the declared overload', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect(await selected(String.raw`C:\fixture\calls.ts`, 'C:/fixture/calls.ts')).toBe('declared')
  })

  it('drops extended-length prefixes and dot segments where nothing resolves (an unmounted drive)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const letter = DRIVE_LETTERS.find((value) => !existsSync(`${value}:${path.win32.sep}`)) ?? 'Q'
    const candidate = spelled(
      String.raw`\\?`,
      `${letter}:`,
      'fixture',
      '.',
      'nested',
      '..',
      'calls.ts',
    )
    expect(await selected(`${letter}:/fixture/calls.ts`, candidate)).toBe('declared')
  })

  it.each(['win32', 'linux', 'darwin'])(
    'uses the filesystem case policy on %s without merging distinct POSIX files',
    async (platform) => {
      Object.defineProperty(process, 'platform', { value: platform })
      const path = platform === 'win32' ? 'C:/fixture/calls.ts' : '/fixture/calls.ts'
      const candidate = platform === 'win32' ? 'c:/FIXTURE/CALLS.ts' : '/fixture/CALLS.ts'
      const answer = selected(path, candidate)
      // No candidate is this document: the first item is never guessed.
      await (platform === 'win32'
        ? expect(answer).resolves.toBe('declared')
        : expect(answer).rejects.toThrow('MHP_CALL_HIERARCHY_AMBIGUOUS'))
    },
  )

  it('keeps a lone provider item, which needs no selection', async () => {
    vi.mocked(vscode.commands.executeCommand)
      .mockResolvedValueOnce([item('only', '/declared/elsewhere.ts')])
      .mockResolvedValueOnce([])
    const answer = await vscodeLanguageServices().callHierarchy(
      '/fixture/calls.ts',
      { line: 1, character: 1 },
      'incoming',
    )
    expect(answer).toMatchObject({ item: { name: 'only' }, otherItems: 0 })
  })
})

/** Segments joined as written: `path.join` would collapse the `.` and `..` under test. */
function spelled(...segments: string[]): string {
  return segments.join(path.win32.sep)
}

/** A writable drive other than the temporary folder's, with a private folder on it. */
async function otherDriveFolder(): Promise<string> {
  const own = path.parse(tmpdir()).root.toUpperCase()
  for (const letter of DRIVE_LETTERS) {
    const root = `${letter}:${path.win32.sep}`
    if (root === own) continue
    try {
      return await mkdtemp(path.join(root, 'm104pd-calls-'))
    } catch {
      // Absent, read-only or full: try the next letter.
    }
  }
  throw new Error('M104_NO_SECOND_WRITABLE_DRIVE')
}

/** The 8.3 alias Windows keeps for a long name (cmd's `%~s` expansion). */
function shortName(longPath: string): string {
  return execSync(`for %I in ("${longPath}") do @echo %~sI`, { encoding: 'utf8' }).trim()
}

// Real files in a private folder on this PC: every spelling resolves to the one declared file.
describe.runIf(process.platform === 'win32')(
  'call-hierarchy identity of real Windows files',
  () => {
    const spellings = new Map<
      string,
      readonly [document: string, candidate: string, elsewhere: string]
    >()
    const cleanup: (() => Promise<void>)[] = []
    let declared = ''
    let sameNameElsewhere = ''

    beforeAll(async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'm104pd-calls-'))
      cleanup.push(() => rm(root, { recursive: true, force: true }))
      const folder = path.join(root, 'Long Declared Folder')
      await mkdir(folder)
      declared = path.join(folder, 'calls.ts')
      await writeFile(declared, 'export function calls() {}\n')
      const junction = path.join(root, 'linked')
      await symlink(folder, junction, 'junction')
      cleanup.unshift(() => rmdir(junction))
      const other = await otherDriveFolder()
      cleanup.push(() => rm(other, { recursive: true, force: true }))
      sameNameElsewhere = path.join(other, 'calls.ts')
      await writeFile(sameNameElsewhere, 'export function calls() {}\n')
      const otherJunction = path.join(root, 'other-drive')
      await symlink(other, otherJunction, 'junction')
      cleanup.unshift(() => rmdir(otherJunction))
      const short = shortName(folder)
      expect(short, 'this volume generates no 8.3 aliases').not.toBe(folder)
      // The same name on the other drive is the decoy for local spellings, and the local file for the other drive.
      const share = spelled('', '', 'localhost', `${declared.slice(0, 1)}$`, declared.slice(3))
      const local = (candidate: string) => [declared, candidate, sameNameElsewhere] as const
      spellings.set('extended', local(path.win32.toNamespacedPath(declared)))
      spellings.set('extendedUnc', [share, path.win32.toNamespacedPath(share), sameNameElsewhere])
      spellings.set('dotSegments', local(spelled(folder, '.', 'nested', '..', 'calls.ts')))
      spellings.set('shortName', local(path.join(short, 'calls.ts')))
      spellings.set('junction', local(path.join(junction, 'calls.ts')))
      spellings.set('otherDrive', [
        sameNameElsewhere,
        path.join(otherJunction, 'calls.ts'),
        declared,
      ])
    })
    afterAll(async () => {
      for (const step of cleanup) await step()
    })

    it.each(['extended', 'extendedUnc', 'dotSegments', 'shortName', 'junction', 'otherDrive'])(
      'selects the declared overload spelled %s',
      async (name) => {
        const [document = '', candidate = '', elsewhere = ''] = spellings.get(name) ?? []
        expect(candidate).not.toBe('')
        expect(await selected(document, candidate, elsewhere)).toBe('declared')
      },
    )

    it('reports ambiguity instead of guessing when the declared file is on another drive', async () => {
      await expect(
        selected(declared, sameNameElsewhere, path.join(declared, '..', 'x.ts')),
      ).rejects.toThrow('MHP_CALL_HIERARCHY_AMBIGUOUS')
    })
  },
)
