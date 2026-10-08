// SECWINPATH2 (2026-10-08): the protected-write and checkpoint-storage guards
// judge the real file whatever spelling a path uses, on any drive letter and
// through relocated profile folders, without refusing ordinary workspaces.
// The native suite runs only on Windows: real `dir /x` short names, `subst`
// letters, `mklink /J` junctions, directory symbolic links where the account
// may create them, loopback administrative shares and WSL where present. It
// prints why it skips a probe, never changes permissions, and removes every
// mapping and folder it made.

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { pathIdentityRelation } from '../../src/core/pathIdentity'
import { isProtectedFileAccess } from '../../src/core/protectedPaths'
import { normalWindowsPath, windowsPathProblem } from '../../src/core/windowsPathSpelling'
import { resolveWorkspacePath } from '../../src/core/workspacePath'
import { holdFor } from '../../src/core/worktreeConversations'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import * as fileIdentity from '../../src/core/fs/fileIdentity'
import {
  createCheckpointPort,
  withCheckpointStorageGuard,
} from '../../src/host/checkpoints/checkpointHost'
import { MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { checkpointPort, harness, removeCheckpointFolders } from './helpers/checkpointHarness'
import { noopToolIo } from './helpers/fakeToolIo'
import { capturedWriteRequested } from './helpers/protectedWriteCapture'
import { adminShare } from './helpers/secWinShare'

const isWindows = process.platform === 'win32'
// At least C:, D: and a late letter, whatever drive Windows itself is on.
const LETTERS = ['C', 'D', 'Z'] as const
// Muse Code's local verbatim prefix, `\\?\`.
const VERBATIM = '\\\\?\\'

afterEach(removeCheckpointFolders)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function write(subject: string): { kind: string; path: string; access: string } {
  return { kind: 'fileAccess', path: subject, access: 'write' }
}

describe('SECWINPATH2 spellings on any drive letter', () => {
  it.each(LETTERS)('accepts the CLI’s own \\\\?\\%s:\\ and keeps every segment rule', (letter) => {
    const ws = String.raw`${letter}:\w`
    const verbatim = String.raw`${VERBATIM}${ws}`
    expect(normalWindowsPath(String.raw`${verbatim}\notes.txt`)).toBe(String.raw`${ws}\notes.txt`)
    expect(windowsPathProblem(String.raw`${verbatim}\notes.txt`, 'win32')).toBeUndefined()
    expect(resolveWorkspacePath(ws, String.raw`${verbatim}\notes.txt`, 'win32')).toMatchObject({
      ok: true,
      absolute: String.raw`${ws}\notes.txt`,
      relative: 'notes.txt',
    })
    const segmentRules = [
      [String.raw`${verbatim}\.git.\config`, MODEL_TEXT.windowsTrailingName],
      [String.raw`${verbatim}\AGENTS.md `, MODEL_TEXT.windowsTrailingName],
      [String.raw`${verbatim}\AGENTS.md::$DATA`, MODEL_TEXT.windowsAlternateStream],
      [String.raw`${verbatim}\src\CON`, MODEL_TEXT.windowsReservedDevice],
      [String.raw`${verbatim}\src\lpt¹..`, MODEL_TEXT.windowsReservedDevice],
    ] as const
    for (const [given, reason] of segmentRules) {
      expect(windowsPathProblem(given, 'win32'), given).toBe(reason)
    }
    // Device and global namespaces keep their prefix and stay refused.
    for (const given of [
      `\\\\.\\${ws}\\x`,
      `\\??\\${ws}\\x`,
      `\\\\?\\UNC\\localhost\\${letter}$\\w\\x`,
      String.raw`\\?\GLOBALROOT\Device\HarddiskVolume3\w\x`,
      String.raw`\\?\Volume{0b1c2d3e-0000-0000-0000-100000000000}\w\x`,
      String.raw`${VERBATIM}${letter}:/w/x`,
      `//?/${letter}:/w/x`,
    ]) {
      expect(windowsPathProblem(given, 'win32'), given).toBe(MODEL_TEXT.windowsDeviceNamespace)
    }
    expect(windowsPathProblem(`\\\\localhost\\${letter}$\\w\\x`, 'win32')).toBe(
      MODEL_TEXT.windowsUncOutsideWorkspace,
    )
  })

  it.each(LETTERS)('refuses drive-relative %s: spellings everywhere', (letter) => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    for (const given of [
      `${letter}:.claude\\settings.json`,
      `${letter}:AGENTS.md`,
      `${letter}:.git\\config`,
      `${letter}:notes.txt`,
      `${letter}:`,
    ]) {
      expect(windowsPathProblem(given, 'win32'), given).toBe(MODEL_TEXT.windowsDriveRelative)
      expect(resolveWorkspacePath(String.raw`${letter}:\w`, given, 'win32').ok, given).toBe(false)
      expect(isProtectedFileAccess(write(given)), given).toBe(true)
    }
    expect(windowsPathProblem(`${letter}:/w/notes.txt`, 'win32')).toBeUndefined()
  })

  it('refuses only real device names; a real extension is an ordinary name', () => {
    for (const name of ['CON', 'con..', 'PRN ', 'AUX', 'NUL. .', 'COM1', 'LPT9', 'COM¹', 'LPT³']) {
      expect(windowsPathProblem(`src/${name}`, 'win32'), name).toBe(
        MODEL_TEXT.windowsReservedDevice,
      )
    }
    expect(windowsPathProblem('src/CON:', 'win32')).toBe(MODEL_TEXT.windowsAlternateStream)
    for (const name of ['con.d', 'aux.js', 'nul.txt', 'COM1.txt', 'LPT¹.log', 'COM0', 'LPT0']) {
      expect(windowsPathProblem(`C:\\Users\\dev\\${name}\\ws\\notes.txt`, 'win32'), name).toBe(
        undefined,
      )
    }
  })

  it('names a refused spelling with its own sentence, and storage with its own', async () => {
    const h = await harness({ git: 'none' })
    mkdirSync(h.storage, { recursive: true })
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const spellings = [
      String.raw`C:\ws\a.txt::$DATA`,
      String.raw`C:\ws\.git.\config`,
      String.raw`\\.\C:\ws\x`,
      'C:notes.txt',
    ]
    const withoutStore = createCheckpointPort({
      store: undefined,
      isNamespaceKnown: () => true,
      isWorkspaceTrusted: () => true,
      isEnabled: () => false,
      hasGit: () => true,
    })
    for (const spelling of spellings) {
      expect(h.store.storagePathProblem(spelling), spelling).toBe(UI_TEXT.windowsPathRefused)
      expect(() => {
        withoutStore.refuseStorageWrite(spelling)
      }).toThrow(UI_TEXT.windowsPathRefused)
    }
    vi.unstubAllGlobals()
    const inside = path.join(h.storage, 'm86', 'x', 'journal.jsonl')
    expect(h.store.storagePathProblem(inside)).toBe(MODEL_TEXT.checkpointStorageWrite)
    const nativeStat = fileIdentity.statIdentitySync
    vi.spyOn(fileIdentity, 'statIdentitySync').mockImplementation((given) => {
      if (given === h.root) throw Object.assign(new Error('refused'), { code: 'EACCES' })
      return nativeStat(given)
    })
    expect(() => {
      checkpointPort(h).refuseStorageWrite(path.join(h.root, 'new.txt'))
    }).toThrow(UI_TEXT.checkpointStorageUncertain)
  })

  it('judges a missing held folder by its nearest existing ancestor and its own name', async () => {
    const h = await harness({ git: 'none' })
    mkdirSync(h.storage, { recursive: true })
    const held = path.join(h.storage, 'pull-request-worktrees')
    expect(holdFor([h.root], [held], [], process.platform)).toBeUndefined()
    expect(pathIdentityRelation(path.join(held, 'pr1', 'x'), held)).toBe('inside')
    expect(pathIdentityRelation(path.join(h.storage, 'other', 'x'), held)).toBe('outside')
    expect(holdFor([path.join(held, 'pr1')], [held], [], process.platform)).toBeDefined()
  })
})

interface Native {
  base: string
  ws: string
  storage: string
  held: string
  letters: string[]
  links: string[]
}

const native: Native = { base: '', ws: '', storage: '', held: '', letters: [], links: [] }

function skipWith(reason: string, skip: (note?: string) => void): void {
  console.info(`SECWINPATH2: ${reason}; skipping`)
  skip(reason)
}

/** The 8.3 name `dir /x` lists for `name` in `folder`, if the volume makes one. */
function shortName(folder: string, name: string): string | undefined {
  const listing = execFileSync('cmd.exe', ['/d', '/c', 'dir', '/x', '/a', folder], {
    encoding: 'utf8',
    windowsHide: true,
  })
  // Any locale's date columns: the line ends with the 8.3 name, then the long one.
  for (const line of listing.split(/\r?\n/u)) {
    const tokens = line.trim().split(/\s+/u)
    const alias = tokens.at(-2)
    if (tokens.at(-1) === name && alias !== undefined && /~\d/u.test(alias)) return alias
  }
  return undefined
}

/** `relative` spelled with each segment's 8.3 name. */
function shortSpelling(root: string, relative: string): string | undefined {
  let long = root
  let short = root
  for (const part of relative.split('\\')) {
    const alias = shortName(long, part)
    if (alias === undefined && part.startsWith('.')) return undefined
    short = path.join(short, alias ?? part)
    long = path.join(long, part)
  }
  return short
}

function subst(letter: string, target: string): boolean {
  try {
    execFileSync('subst', [`${letter}:`, target], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

function junction(link: string, target: string): void {
  symlinkSync(target, link, 'junction')
  native.links.push(link)
}

function seedWorkspace(ws: string): void {
  for (const folder of ['.claude', '.git', String.raw`.github\workflows`, 'ordinaryfolder'])
    mkdirSync(path.join(ws, folder), { recursive: true })
  writeFileSync(path.join(ws, '.claude', 'settings.json'), '{}')
  writeFileSync(path.join(ws, '.git', 'config'), '')
  writeFileSync(path.join(ws, '.github', 'workflows', 'ci.yml'), '')
  writeFileSync(path.join(ws, 'ordinaryfolder', 'notes.txt'), '')
  writeFileSync(path.join(ws, 'AGENTS.md'), '')
}

const PROTECTED = [
  String.raw`.claude\settings.json`,
  String.raw`.git\config`,
  String.raw`.github\workflows\ci.yml`,
]

describe.runIf(isWindows)('SECWINPATH2 native identity on Windows', () => {
  beforeAll(() => {
    native.base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-win2-')))
    native.ws = path.join(native.base, 'ws')
    seedWorkspace(native.ws)
    native.storage = path.join(native.base, 'storage', 'checkpoints')
    mkdirSync(native.storage, { recursive: true })
    native.held = path.join(native.base, 'storage', 'pull-request-worktrees')
    // Two free letters (a late one first), mapped onto the scratch folder.
    for (const letter of 'ZYXWVUTSRQPONMLKJIHGF') {
      if (native.letters.length === 2) break
      if (!existsSync(`${letter}:\\`) && subst(letter, native.base)) native.letters.push(letter)
    }
  })
  afterAll(() => {
    for (const link of native.links.toReversed()) rmdirSync(link)
    for (const letter of native.letters) execFileSync('subst', [`${letter}:`, '/d'])
    rmSync(native.base, { recursive: true, force: true })
  })

  it('protects real 8.3 names of .claude, .git and .github\\workflows on every letter', (ctx) => {
    const aliases = PROTECTED.map((relative) => shortSpelling(native.ws, relative))
    if (aliases.includes(undefined)) {
      skipWith('8.3 names are off on this volume', (note) => ctx.skip(note))
      return
    }
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const ordinary = shortSpelling(native.ws, String.raw`ordinaryfolder\notes.txt`)
    expect(ordinary).toMatch(/~\d/u)
    const roots = [native.ws, ...native.letters.map((letter) => String.raw`${letter}:\ws`)]
    for (const root of roots) {
      for (const alias of aliases) {
        const spelled = path.join(root, path.relative(native.ws, alias ?? ''))
        expect(isProtectedFileAccess(write(spelled)), spelled).toBe(true)
        expect(isProtectedFileAccess(write(String.raw`${VERBATIM}${spelled}`)), spelled).toBe(true)
      }
      const twin = path.join(root, path.relative(native.ws, ordinary ?? ''))
      expect(isProtectedFileAccess(write(twin)), twin).toBe(false)
      expect(isProtectedFileAccess(write(String.raw`${VERBATIM}${twin}`)), twin).toBe(false)
    }
    const claude = path.dirname(aliases[0] ?? '')
    expect(isProtectedFileAccess(write(path.join(claude, 'new.json')))).toBe(true)
    expect(isProtectedFileAccess(write(path.join(path.dirname(ordinary ?? ''), 'new.txt')))).toBe(
      false,
    )
    // An 8.3-shaped name nothing resolves (yet) is protected, as is a relative one.
    expect(isProtectedFileAccess(write(path.join(native.ws, 'NOSUCH~1', 'x.txt')))).toBe(true)
    expect(isProtectedFileAccess(write(String.raw`CLAUDE~1\settings.json`))).toBe(true)
    // Through the real mapper: no Edit automatically, no standing rule.
    const mapped = mapNotification({
      method: 'approval/requested',
      params: capturedWriteRequested('session', String.raw`${VERBATIM}${aliases[1] ?? ''}`, false),
    })
    expect(mapped).toMatchObject({ event: { isProtectedWrite: true } })
  })

  it('treats a share or WSL workspace by identity: not held, writes allowed, storage refused', async (ctx) => {
    const h = await harness({ git: 'none' })
    mkdirSync(h.storage, { recursive: true })
    const held = path.join(h.storage, 'pull-request-worktrees')
    const spellings: string[] = []
    const share = adminShare(h.root)
    if (share !== undefined) spellings.push(share)
    const users = path.join(process.env['SystemDrive'] ?? '', 'Users')
    if (h.root.toLowerCase().startsWith(`${users.toLowerCase()}\\`)) {
      const viaUsers = String.raw`\\localhost\Users${h.root.slice(users.length)}`
      try {
        statSync(viaUsers)
        spellings.push(viaUsers)
      } catch (error: unknown) {
        console.info(`SECWINPATH2: \\\\localhost\\Users unavailable (${String(error)}); skipping`)
      }
    }
    if (spellings.length === 0) {
      skipWith('no loopback share reaches the scratch folder', (note) => ctx.skip(note))
      return
    }
    for (const ws of spellings) {
      for (const isHeldPresent of [false, true]) {
        if (isHeldPresent) mkdirSync(held)
        expect(holdFor([ws], [held], [], 'win32'), `${ws} ${String(isHeldPresent)}`).toBe(undefined)
        if (isHeldPresent) rmdirSync(held)
      }
      expect(resolveWorkspacePath(ws, 'new.txt', 'win32').ok).toBe(true)
      // Both ways round, as the shadow repository's separation check asks.
      expect(pathIdentityRelation(path.join(ws, 'new.txt'), h.storage), ws).toBe('outside')
      expect(pathIdentityRelation(h.storage, ws), ws).toBe('outside')
      const store = h.reopenAt(h.storage, ws)
      const destination = String.raw`${ws}\new.txt`
      expect(store.storagePathProblem(destination), destination).toBeUndefined()
      const writes = vi.fn(() => Promise.resolve())
      const guarded = withCheckpointStorageGuard(
        { ...noopToolIo, writeFile: writes },
        checkpointPort({ store }),
      )
      await guarded.writeFile(destination, 'x')
      expect(writes).toHaveBeenCalledOnce()
    }
    // The real storage, reached through the share, is still storage.
    const storageShare = adminShare(path.join(h.storage, 'm86', 'x', 'journal.jsonl'))
    if (storageShare !== undefined) {
      expect(h.store.storagePathProblem(storageShare)).toBe(MODEL_TEXT.checkpointStorageWrite)
      expect(holdFor([adminShare(path.join(held, 'pr1')) ?? ''], [held], [], 'win32')).toBeDefined()
    }
  })

  it('treats WSL (device 0) and another volume as outside storage', async (ctx) => {
    const h = await harness({ git: 'none' })
    mkdirSync(h.storage, { recursive: true })
    const held = path.join(h.storage, 'pull-request-worktrees')
    const others: string[] = []
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`
      if (native.letters.includes(letter) || !existsSync(root)) continue
      try {
        if (statSync(root, { bigint: true }).dev === statSync(h.root, { bigint: true }).dev)
          continue
        statSync(path.join(root, 'sec-win2-missing'))
      } catch (error: unknown) {
        // Only a volume that answers ENOENT for a missing name proves "outside".
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') others.push(root)
      }
    }
    let wsl: string | undefined
    try {
      // Never start Docker Desktop's own distributions.
      const distro = execFileSync('wsl.exe', ['--list', '--quiet'], {
        encoding: 'utf16le',
        timeout: 10_000,
        windowsHide: true,
      })
        .split(/\r?\n/u)
        .map((name) => name.replaceAll('\0', '').trim())
        .find((name) => name !== '' && !name.startsWith('docker-desktop'))
      if (distro !== undefined) wsl = `\\\\wsl.localhost\\${distro}\\tmp`
      if (wsl !== undefined) statSync(wsl)
    } catch (error: unknown) {
      console.info(`SECWINPATH2: WSL unavailable (${String(error)}); skipping its probe`)
      wsl = undefined
    }
    if (others.length === 0 && wsl === undefined) {
      skipWith('no other volume or WSL distribution is reachable', (note) => ctx.skip(note))
      return
    }
    for (const root of [...others, ...(wsl === undefined ? [] : [wsl])]) {
      const candidate = path.join(root, 'sec-win2-missing', 'new.txt')
      expect(pathIdentityRelation(candidate, h.storage), candidate).toBe('outside')
      expect(h.store.storagePathProblem(candidate), candidate).toBeUndefined()
    }
    if (wsl !== undefined) {
      expect(statSync(wsl, { bigint: true }).dev).toBe(0n)
      expect(holdFor([wsl], [held], [], 'win32')).toBeUndefined()
      expect(resolveWorkspacePath(wsl, 'new.txt', 'win32').ok).toBe(true)
    }
  })

  it('keeps storage on a non-C: letter refused through both spellings', (ctx) => {
    if (native.letters.length === 0) {
      skipWith('no free drive letter for subst', (note) => ctx.skip(note))
      return
    }
    for (const letter of native.letters) {
      const storage = String.raw`${letter}:\storage\checkpoints`
      const workspace = String.raw`${letter}:\ws`
      expect(pathIdentityRelation(path.join(storage, 'x', 'journal.jsonl'), storage)).toBe('inside')
      expect(pathIdentityRelation(path.join(native.storage, 'x', 'journal.jsonl'), storage)).toBe(
        'inside',
      )
      expect(pathIdentityRelation(path.join(storage, 'x'), native.storage)).toBe('inside')
      // A workspace on another letter than storage is outside it, both ways round.
      expect(pathIdentityRelation(path.join(workspace, 'new.txt'), native.storage)).toBe('outside')
      expect(pathIdentityRelation(path.join(native.ws, 'new.txt'), storage)).toBe('outside')
      expect(holdFor([workspace], [path.join(native.base, 'storage', 'held')], [], 'win32')).toBe(
        undefined,
      )
      expect(resolveWorkspacePath(workspace, 'new.txt', 'win32').ok).toBe(true)
    }
  })

  it('writes inside a device-like folder with a real extension, made by Win32', async () => {
    const folder = path.join(native.base, 'con.d')
    execFileSync('cmd.exe', ['/d', '/c', 'mkdir', path.join(folder, 'ws')], { windowsHide: true })
    const ws = path.join(folder, 'ws')
    writeFileSync(path.join(ws, 'notes.txt'), 'x')
    // Win32 opens it as an ordinary file, not the console device.
    const typed = execFileSync('cmd.exe', ['/d', '/c', 'type', path.join(ws, 'notes.txt')], {
      encoding: 'utf8',
      windowsHide: true,
    })
    expect(typed).toBe('x')
    const h = await harness({ git: 'none' })
    const store = h.reopenAt(h.storage, ws)
    const target = path.join(ws, 'notes.txt')
    expect(resolveWorkspacePath(ws, target, 'win32').ok).toBe(true)
    expect(store.storagePathProblem(target)).toBeUndefined()
    const writes = vi.fn(() => Promise.resolve())
    await withCheckpointStorageGuard(
      { ...noopToolIo, writeFile: writes },
      checkpointPort({ store }),
    ).writeFile(target, 'x')
    expect(writes).toHaveBeenCalledOnce()
    expect(isProtectedFileAccess(write(String.raw`${VERBATIM}${target}`))).toBe(false)
    expect(isProtectedFileAccess(write(path.join(ws, '.git', 'config')))).toBe(true)
  })

  it('judges relocated profile folders by identity through junctions and links', async () => {
    const profile = path.join(native.base, 'profile')
    const other = path.join(native.base, 'otherdrive')
    const realDocs = path.join(other, 'Documents')
    mkdirSync(profile)
    seedWorkspace(path.join(realDocs, 'proj'))
    const letter = native.letters[0]
    // Documents moved to "another drive": a junction to its subst spelling when one exists.
    junction(
      path.join(profile, 'Documents'),
      letter === undefined ? realDocs : String.raw`${letter}:\otherdrive\Documents`,
    )
    const spellings = [path.join(profile, 'Documents', 'proj'), path.join(realDocs, 'proj')]
    if (letter !== undefined) spellings.push(String.raw`${letter}:\otherdrive\Documents\proj`)
    try {
      symlinkSync(realDocs, path.join(profile, 'Docs-link'), 'dir')
      native.links.push(path.join(profile, 'Docs-link'))
      spellings.push(path.join(profile, 'Docs-link', 'proj'))
    } catch (error: unknown) {
      console.info(`SECWINPATH2: directory symbolic links refused here (${String(error)})`)
    }
    // A link inside the workspace to its .git is the protected folder too.
    junction(path.join(realDocs, 'proj', 'gitlink'), path.join(realDocs, 'proj', '.git'))
    // AppData moved the same way, with the extension's storage below it.
    const realStorage = path.join(other, 'AppData', 'Code', 'globalStorage', 'pub', 'checkpoints')
    mkdirSync(realStorage, { recursive: true })
    junction(path.join(profile, 'AppData'), path.join(other, 'AppData'))
    const linkedStorage = path.join(
      profile,
      'AppData',
      'Code',
      'globalStorage',
      'pub',
      'checkpoints',
    )
    const held = path.join(linkedStorage, '..', 'pull-request-worktrees')
    const h = await harness({ git: 'none' })
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    for (const ws of spellings) {
      expect(isProtectedFileAccess(write(path.join(ws, '.claude', 'settings.json'))), ws).toBe(true)
      expect(isProtectedFileAccess(write(String.raw`${VERBATIM}${ws}\.git\config`)), ws).toBe(true)
      expect(isProtectedFileAccess(write(path.join(ws, 'gitlink', 'config'))), ws).toBe(true)
      expect(isProtectedFileAccess(write(String.raw`${VERBATIM}${ws}\notes.txt`)), ws).toBe(false)
      expect(isProtectedFileAccess(write(path.join(ws, 'ordinaryfolder', 'notes.txt'))), ws).toBe(
        false,
      )
      expect(resolveWorkspacePath(ws, 'notes.txt', 'win32').ok, ws).toBe(true)
      expect(holdFor([ws], [held], [], 'win32'), ws).toBeUndefined()
      for (const storage of [linkedStorage, realStorage]) {
        const store = h.reopenAt(storage, ws)
        expect(store.storagePathProblem(path.join(ws, 'new.txt')), ws).toBeUndefined()
        for (const inside of [linkedStorage, realStorage]) {
          const journal = path.join(inside, 'm86', 'x', 'journal.jsonl')
          expect(store.storagePathProblem(journal), journal).toBe(MODEL_TEXT.checkpointStorageWrite)
        }
      }
    }
    expect(spellings.length).toBeGreaterThanOrEqual(letter === undefined ? 2 : 3)
  })
})

// The admitted controls above are only meaningful if refusals still happen.
describe('SECWINPATH2 ordinary controls use a refused twin', () => {
  it('keeps a writer adapter’s refusal for the stream twin of an admitted write', async () => {
    const h = await harness({ git: 'none' })
    const writes = vi.fn<ToolIo['writeFile']>(() => Promise.resolve())
    const guarded = withCheckpointStorageGuard(
      { ...noopToolIo, writeFile: writes },
      checkpointPort(h),
    )
    await guarded.writeFile(path.join(h.root, 'notes.txt'), 'x')
    expect(writes).toHaveBeenCalledOnce()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    await expect(guarded.writeFile(String.raw`C:\ws\notes.txt::$DATA`, 'x')).rejects.toThrow(
      UI_TEXT.windowsPathRefused,
    )
    expect(writes).toHaveBeenCalledOnce()
  })
})
