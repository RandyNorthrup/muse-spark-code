// Lane M91-S: the shell keeps its directory between calls (PLAN.md M91 step
// 4, acceptance 9; the lead's side-file decision). A `cd` in one shell call
// carries into the next call of the same session; a new session starts at the
// workspace root; a directory outside the workspace resets to the root with a
// note. The host wraps the user's command with a trailer reporting the final
// directory to the session's side file and reads it back (never the output,
// which can be truncated). The declared tool description and schema never
// change (SoL-Pi rule 1); `then_run` and `run_checks` still run at the root.

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import {
  parseShellDirectoryReport,
  shellDirectoryTrailer,
  shellToolFor,
  toolDefinitions,
} from '../../src/core/backends/modelapi/tools'
import type { ShellResult } from '../../src/core/shellResult'
import { SETTING_DEFAULTS, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { createToolIo } from '../../src/host/backend/toolIo'
import { readSettings } from '../../src/host/settings'
import { FakeLogOutputChannel, fakeSettingsSource } from './helpers/fakes'
import { memoryContextIo } from './helpers/fakeContextIo'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  responseOutputsByCall,
  type FakeModelApi,
} from './helpers/fakeModelApi'
import { memoryToolIo, refusedAtEntry, type MemoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'
import { editThenRunCall } from './helpers/shellTurns'

const LINUX_ROOT = '/ws'
const WINDOWS_ROOT = 'C:/ws'
const POSIX_HOME = '/home/tester'
const WINDOWS_HOME = String.raw`C:\Users\tester`

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** What the emulated shell refuses to `cd` into: the fixture's truth. */
function missingSet(
  platform: NodeJS.Platform,
  root: string,
  targets: readonly string[],
): Set<string> {
  const p = pathApi(platform)
  return new Set(
    targets.map((target) =>
      p.isAbsolute(target) ? p.normalize(target) : p.normalize(p.join(root, target)),
    ),
  )
}

function resolveEmulatedCd(
  platform: NodeJS.Platform,
  cwd: string,
  target: string,
  home: string,
): string | undefined {
  if (target === '') {
    // A bare `cd` goes home, outside the workspace: the host must reset.
    return home
  }
  if (target === '.') {
    return cwd
  }
  if (target === '-') {
    return undefined
  }
  const p = pathApi(platform)
  if (p.isAbsolute(target)) {
    return p.normalize(target)
  }
  if (platform === 'win32' && /^[A-Za-z]:[^\\/]/.test(target)) {
    // Drive-relative: refused, as Windows does without a per-drive cwd.
    return undefined
  }
  return p.normalize(p.join(cwd, target))
}

interface EmulatedReport {
  readonly dir: string
  readonly exitCode: number
  readonly stderr: string
  /** False when the trailer never ran (`exit`), so nothing is reported. */
  readonly reported: boolean
}

/**
 * The test double for a real shell: it honours the trailer the host appends
 * (sequence and side file are read from the command, so this fails if the
 * format drifts) and emulates `cd` lexically: navigation always "succeeds"
 * unless the target is in `missing`, and the host's own validation decides
 * what is kept. `exit` skips the trailer, as a real shell would.
 */
function emulateShell(
  platform: NodeJS.Platform,
  command: string,
  cwd: string,
  home: string,
  missing: ReadonlySet<string>,
):
  | { readonly report: EmulatedReport; readonly sideFile: string; readonly sequence: number }
  | undefined {
  // The trailer is unconditional (`;`): an `&&`-joined trailer would skip a
  // failing command, and the emulation honours that, so a drill breaking the
  // join goes red on the failing-command case instead of everywhere.
  const marker = platform === 'win32' ? '; $__m91code=$LASTEXITCODE' : '; __m91status=$?'
  const conditionalMarker = ' && __m91status=$?'
  const at = command.lastIndexOf(marker)
  const conditionalAt = platform === 'win32' ? -1 : command.lastIndexOf(conditionalMarker)
  if (at === -1 && conditionalAt < 0) {
    return undefined
  }
  const isConditional = conditionalAt > at
  const splitAt = isConditional ? conditionalAt : at
  const user = command.slice(0, splitAt)
  const tail = command.slice(splitAt)
  const sequence = Number(/'(\d+)'/.exec(tail)?.[1] ?? NaN)
  if (!Number.isSafeInteger(sequence)) {
    throw new TypeError(`unrecognised shell trailer: ${tail}`)
  }
  let sideFile: string | undefined
  if (platform === 'win32') {
    const file = /WriteAllText\('((?:[^']|'')*)'/.exec(tail)?.[1]?.replaceAll("''", "'")
    sideFile = file
  } else {
    const start = tail.indexOf("} > '")
    const end = tail.lastIndexOf("' || true; exit")
    const raw = start !== -1 && end > start ? tail.slice(start + "} > '".length, end) : undefined
    sideFile = raw?.replaceAll(String.raw`'\''`, `'`)
  }
  if (sideFile === undefined) {
    throw new Error(`unrecognised shell trailer: ${tail}`)
  }
  const exitFirst = /^\s*exit(?:\s+(\d+))?(\s|;|$)/.exec(user)
  if (exitFirst !== null) {
    return {
      report: { dir: cwd, exitCode: Number(exitFirst[1] ?? 0), stderr: '', reported: false },
      sideFile,
      sequence,
    }
  }
  let dir = cwd
  let exitCode = 0
  const errors: string[] = []
  // A bare `cd` goes home too; `cdfoo` is not a cd; a target never holds a
  // separator (`cd sub; …` targets `sub`, not `sub;`).
  const cdPattern =
    /(?:^|[;&\n|])\s*(?:cd|Set-Location)(?=\s|[;&\n|]|$)(?:\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|]+)))?/g
  let match: RegExpExecArray | null
  while ((match = cdPattern.exec(user)) !== null) {
    const target = match[1] ?? match[2] ?? match[3] ?? ''
    const next = resolveEmulatedCd(platform, dir, target, home)
    if (next === undefined || missing.has(next)) {
      exitCode = 1
      errors.push(`cd: ${target}: no such directory`)
    } else {
      dir = next
      exitCode = 0
    }
  }
  return {
    report: {
      dir: stripTrailingSeparators(dir),
      exitCode,
      stderr: errors.join('\n'),
      reported: !isConditional || exitCode === 0,
    },
    sideFile,
    sequence,
  }
}

// Real shells report no trailing separator (pwd, Get-Location), whatever the
// normalization kept: strip it, except on a filesystem or drive root.
function stripTrailingSeparators(dir: string): string {
  return dir === '/' || /^[A-Za-z]:[\\/]?$/.test(dir) ? dir : dir.replace(/[/\\]+$/, '')
}

function sideFileKey(sideFile: string): string {
  return sideFile.replaceAll('\\', '/')
}

interface ShellSetupOptions {
  readonly files?: Record<string, string>
  readonly platform?: NodeJS.Platform
  /** True tracks; false passes `() => false`; 'absent' omits the dep. */
  readonly keepsDirectory?: boolean | 'absent'
  readonly missing?: readonly string[]
  readonly links?: Record<string, string>
  readonly root?: string
}

interface ShellHarness {
  readonly api: FakeModelApi
  readonly host: ModelApiHost
  readonly io: MemoryToolIo
  readonly session: ModelApiSession
  readonly events: AgentEvent[]
  readonly turnDone: () => Promise<void>
  readonly shellName: string
  readonly root: string
  readonly platform: NodeJS.Platform
  readonly cleanup: () => void
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

/** A new Model API session on `host` at `root`. */
async function startShellSession(host: ModelApiHost, root: string): Promise<ModelApiSession> {
  const started = await host.startSession({
    workspaceRoot: root,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  if (!(started instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  return started
}

async function setupShell(options: ShellSetupOptions = {}): Promise<ShellHarness> {
  const platform = options.platform ?? 'linux'
  const root = options.root ?? (platform === 'win32' ? WINDOWS_ROOT : LINUX_ROOT)
  const keeps = options.keepsDirectory ?? true
  const home = platform === 'win32' ? WINDOWS_HOME : POSIX_HOME
  const missing = missingSet(platform, root, options.missing ?? [])
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(
    options.files ?? {},
    root,
    () => {
      throw new Error('the emulated runShell replaces this')
    },
    options.links ?? {},
  )
  if (platform === 'win32') {
    // Like the real canonical path, backslashes: the memory fake keeps slashes.
    const real = io.realPath
    io.realPath = async (absolutePath) => {
      const resolved = await real(absolutePath)
      return resolved.replaceAll('/', '\\')
    }
  }
  io.runShell = (command, cwd, timeoutMs, _signal, _limit, assertCanRun) => {
    const refused = refusedAtEntry(assertCanRun)
    if (refused !== undefined) {
      return Promise.resolve(refused)
    }
    io.shellCalls.push({ command, cwd, timeoutMs })
    const emulated = emulateShell(platform, command, cwd, home, missing)
    if (emulated === undefined) {
      return Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      })
    }
    if (emulated.report.reported) {
      io.files.set(
        sideFileKey(emulated.sideFile),
        `${String(emulated.sequence)}\n${emulated.report.dir}\n`,
      )
    }
    const result: ShellResult = {
      stdout: '',
      stderr: emulated.report.stderr,
      exitCode: emulated.report.exitCode,
      isTimedOut: false,
      isCancelled: false,
    }
    return Promise.resolve(result)
  }
  const sidecar = mkdtempSync(path.join(tmpdir(), 'm91s-shell-'))
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
  const deps: ModelApiHostDeps = {
    ...fakeModelApiHostDeps({ client, workspaceRoot: root, io, log }),
    platform,
    ...(keeps !== 'absent' && { shellKeepsDirectory: () => keeps }),
    shellSidecarDir: sidecar,
  }
  const host = new ModelApiHost(deps)
  const started = await startShellSession(host, root)
  const { events, turnDone } = watchSessionTurns(started)
  const harness: ShellHarness = {
    api,
    host,
    io,
    session: started,
    events,
    turnDone,
    shellName: shellToolFor(platform).name,
    root,
    platform,
    cleanup: () => {
      rmSync(sidecar, { recursive: true, force: true })
    },
  }
  cleanups.push(harness.cleanup)
  return harness
}

/** One shell call the model makes. */
function shellCall(
  shellName: string,
  command: string,
  callId: string,
): { name: string; arguments: string; callId: string } {
  return { name: shellName, arguments: JSON.stringify({ command, description: command }), callId }
}

async function runTurn(harness: ShellHarness, text: string): Promise<void> {
  const submitted = harness.session.sendTurn([{ type: 'text', text }])
  await submitted
  await harness.turnDone()
}

/** The user's `prompt` turn: the model makes one shell call, then says `reply`. */
async function shellTurn(
  harness: ShellHarness,
  command: string,
  callId: string,
  reply: string,
  prompt: string,
): Promise<void> {
  harness.api.script({ calls: [shellCall(harness.shellName, command, callId)] }, { text: reply })
  await runTurn(harness, prompt)
}

/** The opening most cases share: `cd sub` as call s1. */
async function cdSubTurn(harness: ShellHarness): Promise<void> {
  await shellTurn(harness, 'cd sub', 's1', 'moved', 'Go to sub.')
}

/** "Where are you?": `pwd` as call `callId`. */
async function pwdTurn(harness: ShellHarness, callId: string): Promise<void> {
  await shellTurn(harness, 'pwd', callId, 'here', 'Where are you?')
}

/** The row the panel shows for a finished tool call, by call order. */
function toolRows(
  harness: ShellHarness,
): { tool: string | undefined; visibleOutput: string | undefined }[] {
  return harness.events.flatMap((event) => {
    return event.type !== 'itemCompleted' || event.item.kind !== 'toolCall'
      ? []
      : [{ tool: event.item.tool, visibleOutput: event.item.visibleOutput }]
  })
}

/** The model-facing outputs of one request's tool results, by call id. */
function modelOutputs(harness: ShellHarness, index: number): Map<string, string> {
  return responseOutputsByCall(harness.api, index)
}

describe('the shell directory trailer', () => {
  it('reports through a file on bash, restoring the exit code', () => {
    expect(shellDirectoryTrailer('linux', '/tmp/a b/c', 7)).toBe(
      String.raw`; __m91status=$?; { printf '%s\n' '7'; pwd; } > '/tmp/a b/c' || true; exit $__m91status`,
    )
  })

  it('quotes a hostile side file on bash', () => {
    expect(shellDirectoryTrailer('linux', `/tmp/o'brien/x`, 1)).toBe(
      String.raw`; __m91status=$?; { printf '%s\n' '1'; pwd; } > '/tmp/o'\''brien/x' || true; exit $__m91status`,
    )
  })

  it('reports through .NET on PowerShell, restoring the exit code without a ternary', () => {
    expect(shellDirectoryTrailer('win32', String.raw`C:\a b\c`, 3)).toBe(
      `; $__m91code=$LASTEXITCODE; $__m91ok=$?; try { [System.IO.File]::WriteAllText('C:\\a b\\c', '3' + "\`n" + (Get-Location).Path) } catch {}; $__m91exit=1; if ($__m91code) { $__m91exit=$__m91code }; if ($__m91ok) { exit 0 } else { exit $__m91exit }`,
    )
  })

  it('quotes a drive-letter side file with quotes on PowerShell', () => {
    expect(shellDirectoryTrailer('win32', String.raw`D:\o'brien\x.cud`, 11)).toBe(
      `; $__m91code=$LASTEXITCODE; $__m91ok=$?; try { [System.IO.File]::WriteAllText('D:\\o''brien\\x.cud', '11' + "\`n" + (Get-Location).Path) } catch {}; $__m91exit=1; if ($__m91code) { $__m91exit=$__m91code }; if ($__m91ok) { exit 0 } else { exit $__m91exit }`,
    )
  })

  it('reads the report back, ignoring stale, missing and empty reports', () => {
    expect(parseShellDirectoryReport('4\n/ws/sub\n', 4)).toBe('/ws/sub')
    expect(parseShellDirectoryReport('3\n/ws/sub\n', 4)).toBeUndefined()
    expect(parseShellDirectoryReport(undefined, 4)).toBeUndefined()
    expect(parseShellDirectoryReport('4\n', 4)).toBeUndefined()
    expect(parseShellDirectoryReport('no trailer here', 4)).toBeUndefined()
  })

  it('keeps newlines inside a reported name', () => {
    expect(parseShellDirectoryReport('9\n/ws/we\nird\n', 9)).toBe('/ws/we\nird')
  })
})

describe('the shell tool declaration', () => {
  it('stays byte-stable on every platform (SoL-Pi rule 1: the cache-stable prefix)', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      const { name, shellName } = shellToolFor(platform)
      expect(toolDefinitions(platform)).toContainEqual({
        type: 'function',
        name,
        description: `Run one ${shellName} command line in the workspace root and return its output.`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            description: { type: 'string', description: 'One line saying what the command does' },
            timeout_ms: {
              type: 'integer',
              description: 'Milliseconds before the command is stopped',
            },
          },
          required: ['command', 'description'],
          additionalProperties: false,
        },
        strict: false,
      })
    }
  })
})

/** `text` with its regular-expression metacharacters escaped. */
function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)
}

/** The directory each shell call ran in, in call order. */
function expectCwds(harness: ShellHarness, cwds: readonly string[]): void {
  expect(harness.io.shellCalls.map((call) => call.cwd)).toEqual(cwds)
}

/** Request `index`'s model-facing output for `callId` ends with `text`. */
function expectOutputEnd(harness: ShellHarness, index: number, callId: string, text: string): void {
  expect(modelOutputs(harness, index).get(callId)).toMatch(new RegExp(`${escapeRegExp(text)}$`))
}

/** The tail naming a kept directory, relative to the root. */
function directoryTail(relative: string): string {
  return fill(UI_TEXT.shellDirectory, { path: relative })
}

describe('the kept shell directory', () => {
  it('carries a cd into the next call, naming it only at the tail past the root', async () => {
    const harness = await setupShell()
    await cdSubTurn(harness)
    await shellTurn(harness, 'pwd', 's2', 'there', 'Where are you?')
    // The second command starts where the first ended.
    expectCwds(harness, [harness.root, `${harness.root}/sub`])
    const firstTail = directoryTail('sub')
    // The panel's row names the directory at the tail…
    expect(toolRows(harness).map((row) => row.visibleOutput)).toEqual([
      expect.stringMatching(new RegExp(String.raw`\[exit code 0\]\n${escapeRegExp(firstTail)}$`)),
      expect.stringMatching(new RegExp(String.raw`\[exit code 0\]\n${escapeRegExp(firstTail)}$`)),
    ])
    // …and so does what the model receives in its next request.
    expect(modelOutputs(harness, 1).get('s1')).toMatch(
      new RegExp(String.raw`\[exit code 0\]\n${escapeRegExp(firstTail)}$`),
    )
    await harness.host.close()
  })

  it('adds nothing at the root', async () => {
    const harness = await setupShell()
    await pwdTurn(harness, 's1')
    expectCwds(harness, [harness.root])
    expect(toolRows(harness).map((row) => row.visibleOutput)).toEqual(['[exit code 0]'])
    expect(modelOutputs(harness, 1).get('s1')).toBe('[exit code 0]')
    await harness.host.close()
  })

  it('tracks the directory even when the command fails', async () => {
    const harness = await setupShell({ missing: ['/ws/nope'] })
    await shellTurn(harness, 'cd sub; cd /ws/nope', 's1', 'moved', 'Go to sub.')
    // The trailer is unconditional: the failing tail does not hide the cd.
    expectCwds(harness, [harness.root])
    const tail = directoryTail('sub')
    expect(modelOutputs(harness, 1).get('s1')).toContain('exit code 1')
    expect(modelOutputs(harness, 1).get('s1')).toMatch(
      new RegExp(String.raw`\[exit code 1\]\n${escapeRegExp(tail)}$`),
    )
    await pwdTurn(harness, 's2')
    expectCwds(harness, [harness.root, `${harness.root}/sub`])
    await harness.host.close()
  })

  it('starts a new session at the root', async () => {
    const harness = await setupShell()
    await cdSubTurn(harness)
    expectCwds(harness, [harness.root])
    const second = await startShellSession(harness.host, harness.root)
    const watched = watchSessionTurns(second)
    harness.api.script({ calls: [shellCall(harness.shellName, 'pwd', 's2')] }, { text: 'here' })
    await second.sendTurn([{ type: 'text', text: 'Where are you?' }])
    await watched.turnDone()
    expectCwds(harness, [harness.root, harness.root])
    await harness.host.close()
  })

  it('leaves a failed cd on the previous directory', async () => {
    const harness = await setupShell({ missing: ['/ws/nope'] })
    await cdSubTurn(harness)
    await shellTurn(harness, 'cd /ws/nope', 's2', 'stayed', 'Go missing.')
    await pwdTurn(harness, 's3')
    expectCwds(harness, [harness.root, `${harness.root}/sub`, `${harness.root}/sub`])
    const tail = directoryTail('sub')
    expect(modelOutputs(harness, 3).get('s2')).toContain('exit code 1')
    expectOutputEnd(harness, 3, 's2', tail)
    expectOutputEnd(harness, 5, 's3', tail)
    await harness.host.close()
  })
})

describe('a directory outside the workspace', () => {
  it('returns to the root silently with cd ..', async () => {
    const harness = await setupShell()
    await cdSubTurn(harness)
    await shellTurn(harness, 'cd ..', 's2', 'back', 'Go back.')
    expectCwds(harness, [harness.root, `${harness.root}/sub`])
    // Back at the root: no tail, no note.
    expect(modelOutputs(harness, 3).get('s2')).toBe('[exit code 0]')
    await pwdTurn(harness, 's3')
    expectCwds(harness, [harness.root, `${harness.root}/sub`, harness.root])
    await harness.host.close()
  })

  it.each([
    ['an absolute path outside', 'cd /etc', '/etc'],
    ['past the root with dot-dots', 'cd ../..', '/'],
    ['through a link that leads out', 'cd /ws/linked', '/outside'],
    ['a bare cd home', 'cd', POSIX_HOME],
  ])('resets to the root with a note: %s', async (_name, command, outside) => {
    const harness = await setupShell({ links: { linked: '/outside' } })
    await cdSubTurn(harness)
    await shellTurn(harness, command, 's2', 'out', 'Go out.')
    await pwdTurn(harness, 's3')
    // The escapee ran in sub, but the next call is back at the root.
    expectCwds(harness, [harness.root, `${harness.root}/sub`, harness.root])
    expectOutputEnd(harness, 3, 's2', fill(UI_TEXT.shellDirectoryReset, { path: outside }))
    // Reset, the result carries no directory tail.
    expect(modelOutputs(harness, 5).get('s3')).toBe('[exit code 0]')
    await harness.host.close()
  })

  it('resets when the file system refuses to say', async () => {
    const harness = await setupShell()
    // A `realPath` that rejects: fail closed, back to the root.
    harness.io.realPath = () => Promise.reject(new Error('EACCES'))
    await cdSubTurn(harness)
    await pwdTurn(harness, 's2')
    expectCwds(harness, [harness.root, harness.root])
    expect(modelOutputs(harness, 1).get('s1')).toMatch(/is outside the workspace\.$/)
    await harness.host.close()
  })
})

describe('the setting off', () => {
  it.each([false, 'absent'] as const)(
    'runs every call at the root, untouched: %s',
    async (mode) => {
      const harness = await setupShell({ keepsDirectory: mode })
      await cdSubTurn(harness)
      await pwdTurn(harness, 's2')
      // Today's behaviour: the root every time, the user's command byte-exact, no tail.
      expectCwds(harness, [harness.root, harness.root])
      expect(harness.io.shellCalls.map((call) => call.command)).toEqual(['cd sub', 'pwd'])
      expect(toolRows(harness).map((row) => row.visibleOutput)).toEqual([
        '[exit code 0]',
        '[exit code 0]',
      ])
      await harness.host.close()
    },
  )

  it('is on by default and reads what is configured', () => {
    const log = new FakeLogOutputChannel()
    expect(readSettings(fakeSettingsSource({}), log).modelApiShellKeepsDirectory).toBe(true)
    expect(SETTING_DEFAULTS.modelApiShellKeepsDirectory).toBe(true)
    expect(
      readSettings(fakeSettingsSource({ modelApiShellKeepsDirectory: false }), log)
        .modelApiShellKeepsDirectory,
    ).toBe(false)
  })
})

describe("then_run and the shell's guards", () => {
  it("runs then_run at the root, untrailered, keeping the session's directory", async () => {
    const harness = await setupShell({ files: { 'owned.ts': 'export const one = 1\n' } })
    await cdSubTurn(harness)
    harness.api.script({ calls: [editThenRunCall()] }, { text: 'renamed' })
    await runTurn(harness, 'Rename one to two.')
    await pwdTurn(harness, 's3')
    // The edit's command ran at the root with no trailer; the shell still keeps sub.
    expect(harness.io.shellCalls.map((call) => ({ command: call.command, cwd: call.cwd }))).toEqual(
      [
        { command: expect.stringContaining('cd sub'), cwd: harness.root },
        { command: 'echo then', cwd: harness.root },
        { command: expect.stringContaining('pwd'), cwd: `${harness.root}/sub` },
      ],
    )
    for (const call of harness.io.shellCalls) {
      if (call.command === 'echo then') {
        expect(call.command).not.toContain('__m91')
      }
    }
    expectOutputEnd(harness, 5, 's3', directoryTail('sub'))
    await harness.host.close()
  })

  it('keeps the previous directory when the command exits before the trailer', async () => {
    const harness = await setupShell()
    await cdSubTurn(harness)
    await shellTurn(harness, 'exit 3', 's2', 'left', 'Leave.')
    await pwdTurn(harness, 's3')
    expectCwds(harness, [harness.root, `${harness.root}/sub`, `${harness.root}/sub`])
    expect(modelOutputs(harness, 3).get('s2')).toBe('[exit code 3]')
    expectOutputEnd(harness, 5, 's3', directoryTail('sub'))
    await harness.host.close()
  })
})

describe('the kept shell directory on Windows', () => {
  it('carries a cd across calls, drive letters included', async () => {
    const harness = await setupShell({ platform: 'win32' })
    expect(harness.shellName).toBe('powershell')
    await cdSubTurn(harness)
    await shellTurn(harness, 'cd deeper', 's2', 'deeper', 'Go deeper.')
    const wroot = harness.root.replaceAll('/', '\\')
    expectCwds(harness, [harness.root, String.raw`${wroot}\sub`])
    // The executed lines carry the PowerShell trailer.
    expect(harness.io.shellCalls[0]?.command).toContain('[System.IO.File]::WriteAllText')
    expectOutputEnd(harness, 3, 's2', directoryTail('sub/deeper'))
    await harness.host.close()
  })

  it.each([
    ['a UNC path', String.raw`cd \\server\share`, String.raw`\\server\share`],
    ['another drive', String.raw`cd D:\other`, String.raw`D:\other`],
    ['a bare cd home', 'cd', WINDOWS_HOME],
  ])('resets to the root with a note: %s', async (_name, command, outside) => {
    const harness = await setupShell({ platform: 'win32' })
    await shellTurn(harness, command, 's1', 'out', 'Go out.')
    expectCwds(harness, [harness.root])
    expectOutputEnd(harness, 1, 's1', fill(UI_TEXT.shellDirectoryReset, { path: outside }))
    await pwdTurn(harness, 's2')
    expectCwds(harness, [harness.root, harness.root])
    await harness.host.close()
  })

  it('leaves a drive-relative cd on the previous directory', async () => {
    const harness = await setupShell({ platform: 'win32' })
    await cdSubTurn(harness)
    await shellTurn(harness, 'cd C:other', 's2', 'stayed', 'Go drive-relative.')
    const wroot = harness.root.replaceAll('/', '\\')
    expectCwds(harness, [harness.root, String.raw`${wroot}\sub`])
    expectOutputEnd(harness, 3, 's2', directoryTail('sub'))
    await harness.host.close()
  })
})

describe('the kept shell directory through a real shell', () => {
  it('tracks a real cd across real calls on this platform', async () => {
    const platform = process.platform
    const shellName = shellToolFor(platform).name
    const base = mkdtempSync(path.join(tmpdir(), 'm91s-real-'))
    const root = realpathSync(base)
    mkdirSync(path.join(root, 'sub'))
    const sidecar = mkdtempSync(path.join(tmpdir(), 'm91s-real-sidecar-'))
    cleanups.push(() => {
      rmSync(base, { recursive: true, force: true })
      rmSync(sidecar, { recursive: true, force: true })
    })
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const inner = createToolIo({
      platform,
      systemRoot: process.env['SystemRoot'],
      env: () => ({ ...process.env }),
      listFiles: () => Promise.resolve([]),
      searchWorkerPath: 'unused',
      log: () => undefined,
      unsavedFiles: () => [],
    })
    const cwds: string[] = []
    const recording = {
      ...inner,
      runShell: (async (
        command: string,
        cwd: string,
        timeoutMs: number,
        signal?: AbortSignal,
        limit?: Parameters<typeof inner.runShell>[4],
        assertCanRun?: () => void,
      ) => {
        cwds.push(cwd)
        return await inner.runShell(command, cwd, timeoutMs, signal, limit, assertCanRun)
      }) as typeof inner.runShell,
    }
    const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
    const seed = memoryToolIo({}, root)
    const deps: ModelApiHostDeps = {
      ...fakeModelApiHostDeps({ client, workspaceRoot: root, io: seed, log }),
      platform,
      io: recording,
      contextIo: memoryContextIo(new Map()),
      shellKeepsDirectory: () => true,
      shellSidecarDir: sidecar,
    }
    const host = new ModelApiHost(deps)
    const started = await startShellSession(host, root)
    const { events, turnDone } = watchSessionTurns(started)
    const rows = (): (string | undefined)[] =>
      events.flatMap((event) =>
        event.type === 'itemCompleted' && event.item.kind === 'toolCall'
          ? [event.item.visibleOutput]
          : [],
      )
    const runRealTurn = async (text: string): Promise<void> => {
      await started.sendTurn([{ type: 'text', text }])
      await turnDone()
    }
    api.script({ calls: [shellCall(shellName, 'cd sub', 's1')] }, { text: 'moved' })
    await runRealTurn('Go to sub.')
    const here = platform === 'win32' ? '(Get-Location).Path' : 'pwd'
    api.script({ calls: [shellCall(shellName, here, 's2')] }, { text: 'there' })
    await runRealTurn('Where are you?')
    const p = pathApi(platform)
    // The second command really started in the subdirectory…
    expect(cwds).toEqual([root, p.join(root, 'sub')])
    const tail = fill(UI_TEXT.shellDirectory, { path: 'sub' })
    // …the trailer stayed out of the output, and the tail names it.
    for (const visible of rows()) {
      expect(visible).not.toContain('.cwd')
    }
    expect(rows()[0]).toMatch(new RegExp(String.raw`\[exit code 0\]\n${escapeRegExp(tail)}$`))
    expect(responseOutputsByCall(api, 1).get('s1')).toMatch(
      new RegExp(String.raw`\[exit code 0\]\n${escapeRegExp(tail)}$`),
    )
    // …a real `cd ..` comes back to the root silently…
    api.script({ calls: [shellCall(shellName, 'cd ..', 's3')] }, { text: 'back' })
    await runRealTurn('Go back.')
    expect(cwds[2]).toBe(p.join(root, 'sub'))
    expect(responseOutputsByCall(api, 5).get('s3')).toBe('[exit code 0]')
    // …a second one leaves the workspace and resets with a note…
    api.script({ calls: [shellCall(shellName, 'cd ..', 's4')] }, { text: 'out' })
    await runRealTurn('Go up.')
    expect(cwds[3]).toBe(root)
    expect(responseOutputsByCall(api, 7).get('s4')).toMatch(/is outside the workspace\.\s*$/)
    // …and an exit code survives the trailer at the root, with no tail.
    api.script({ calls: [shellCall(shellName, 'exit 3', 's5')] }, { text: 'left' })
    await runRealTurn('Leave.')
    expect(cwds[4]).toBe(root)
    expect(responseOutputsByCall(api, 9).get('s5')).toBe('[exit code 3]')
    await host.close()
  }, 180_000)
})
