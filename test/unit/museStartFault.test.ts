// A session start that fails because Muse Code (`muse serve`) ends says why
// in our own words, and the ACP boundary lets those words leave (RLF-SMALLFIX2).
// Recorded real exchange: `HOME=<throwaway> muse serve --disable-shell </dev/null`
// run with Muse Code 1.4.14 (1.4.14-R7309.1) on macOS x86_64 on 2026-10-31, in a
// throwaway home whose muse/auth.json was malformed, a folder, mode 000 or
// schema_version 99; each printed the lines below on stderr and exited 3 before
// `initialize`, with no model attempt. The home's path is shown as <home>.
import { RequestError } from '@agentclientprotocol/sdk/unstable'
import { ProtocolError } from '@muse-code/sdk/dist/src/connection/connection.js'
import { spawnMspConnection } from '@muse-code/sdk/dist/src/connection/spawn.js'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isOpenableFolder, outboundError, toOutbound } from '../../src/acp/agent'
import { startFailureText } from '../../src/acp/startText'
import {
  museExitOf,
  museStartFailure,
  stderrStartFault,
  type StderrStartFault,
} from '../../src/core/backends/musecode/startFault'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { isMuseStartError, type MuseStartError } from '../../src/shared/museStartError'

const RECORDED = {
  malformed:
    'compose serve model client: malformed auth file at <home>/.config/muse/auth.json: expected ident at line 1 column 2: expected ident at line 1 column 2',
  notAFile:
    'compose serve model client: failed to read auth file at <home>/.config/muse/auth.json: path is not a regular file: path is not a regular file',
  denied:
    'compose serve model client: failed to read auth file at <home>/.config/muse/auth.json: Permission denied (os error 13): Permission denied (os error 13)',
  schema:
    'compose serve model client: unsupported auth schema version 99 at <home>/.config/muse/auth.json',
  summary:
    'muse serve: exit reason recorded: error (compose serve model client: failed to read auth file at <home>/.config/muse/auth.json: path is not a regular file: path is not a regular file)',
} as const

const CLIENT = { name: 'muse-start-fault-test', version: '0' }

/** What the person is told through the ACP boundary for a failed start. */
function told(error: unknown): string {
  const wire = outboundError(
    toOutbound(RequestError.internalError(undefined, startFailureText(error, 'session'))).failure,
  )
  return wire.message
}

describe('stderrStartFault on the recorded Muse Code lines', () => {
  it('reads an auth file the CLI could not read or parse', () => {
    for (const line of [RECORDED.malformed, RECORDED.notAFile, RECORDED.denied, RECORDED.summary])
      expect(stderrStartFault(`${line}\n`)).toEqual({ fault: 'authFile' })
  })

  it('reads an unsupported schema version, digits only', () => {
    expect(stderrStartFault(`${RECORDED.schema}\n`)).toEqual({
      fault: 'authSchema',
      version: '99',
    })
  })

  it('leaves any other line alone, so its text is never mistaken for a fault', () => {
    for (const line of [
      'startup model-catalog fetch failed',
      'compose serve model client: network is unreachable',
      '',
    ])
      expect(stderrStartFault(line)).toBeUndefined()
  })
})

describe('museStartFailure', () => {
  const stop = new Error(UI_TEXT.questionCancelled)

  it('leaves a stop the caller asked for exactly as it was', () => {
    expect(museStartFailure(stop, { fault: 'authFile' }, { code: 3, signal: null })).toBe(stop)
  })

  it('says the sign-in file, whatever the exit', () => {
    const protocol = new ProtocolError('connection reached EOF')
    const fault: StderrStartFault = { fault: 'authFile' }
    const failure = museStartFailure(protocol, fault, { code: 3, signal: null })
    expect(isMuseStartError(failure)).toBe(true)
    expect(failure).toHaveProperty('message', UI_TEXT.museStart.authFile)
    expect((failure as MuseStartError).cause).toBe(protocol)
  })

  it('names the schema version it was told', () => {
    const protocol = new ProtocolError('x')
    expect(
      museStartFailure(protocol, { fault: 'authSchema', version: '99' }, undefined),
    ).toHaveProperty('message', fill(UI_TEXT.museStart.authSchema, { version: '99' }))
  })
})

/** A real SDK handshake against a real program that ends before it answers. */
async function handshakeThatEnds(
  command: string,
  args: readonly string[],
): Promise<{ readonly error: unknown; readonly exit: ReturnType<typeof museExitOf> }> {
  const handshake = spawnMspConnection({ command, args: [...args] })
  let error: unknown
  try {
    await handshake.initialize({ clientInfo: CLIENT })
  } catch (error_: unknown) {
    error = error_
  }
  return { error, exit: museExitOf(await handshake.close()) }
}

describe('a real handshake that ends before it answers', () => {
  it('says the exit status when the program fails', async () => {
    const { error, exit } = await handshakeThatEnds(process.execPath, ['-e', 'process.exit(3)'])
    expect(exit).toEqual({ code: 3, signal: null })
    const failure = museStartFailure(error, undefined, exit)
    expect(isMuseStartError(failure)).toBe(true)
    expect(failure).toHaveProperty('fault', 'exited')
    expect(failure).toHaveProperty('message', fill(UI_TEXT.museStart.exited, { code: '3' }))
  })

  it('keeps the failure as it was when the program ended with status 0', async () => {
    const { error, exit } = await handshakeThatEnds(process.execPath, ['-e', ''])
    expect(exit).toEqual({ code: 0, signal: null })
    expect(museStartFailure(error, undefined, exit)).toBe(error)
  })

  it.skipIf(process.platform === 'win32')(
    'says the system would not run it when the shell refuses the program (126)',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'musestart-'))
      try {
        const program = path.join(folder, 'muse')
        await writeFile(program, '#!/bin/sh\n', { mode: 0o644 })
        const { error, exit } = await handshakeThatEnds('/bin/sh', ['-c', `exec "${program}"`])
        expect(exit?.code).toBe(126)
        const failure = museStartFailure(error, undefined, exit, 'linux')
        expect(failure).toHaveProperty('fault', 'cannotRun')
        expect(failure).toHaveProperty(
          'message',
          fill(UI_TEXT.museStart.cannotRun, { code: '126' }),
        )
        // The same status on Windows is the program's own: nothing there is a shell.
        expect(museStartFailure(error, undefined, exit, 'win32')).toHaveProperty('fault', 'exited')
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    },
  )
})

/** The real Muse Code CLI, if this computer has it: found the way the product finds it. */
function museCli(): string | undefined {
  if (process.platform === 'win32') return undefined
  const probe = spawnSync('/bin/sh', ['-c', 'command -v muse || true'], { encoding: 'utf8' })
  const found = probe.stdout.trim()
  if (found !== '') return found
  const local = path.join(homedir(), '.local', 'bin', 'muse')
  return spawnSync(local, ['--version']).status === 0 ? local : undefined
}

describe('the real Muse Code CLI refusing a bad sign-in file', () => {
  const cli = museCli()
  let home = ''
  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'musehome-'))
  })
  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** Runs `muse serve` in a throwaway home with this auth file; no network is reached before it refuses. */
  async function refused(
    prepare: (authFile: string) => Promise<void>,
  ): Promise<{ failure: unknown; chunks: string }> {
    const configHome = path.join(home, 'config')
    const authFile = path.join(configHome, 'muse', 'auth.json')
    await rm(configHome, { recursive: true, force: true })
    await mkdir(path.dirname(authFile), { recursive: true })
    await prepare(authFile)
    let chunks = ''
    const handshake = spawnMspConnection({
      command: cli ?? '',
      args: ['serve', '--disable-shell'],
      cwd: home,
      env: { PATH: process.env['PATH'] ?? '', HOME: home, XDG_CONFIG_HOME: configHome },
      onStderr: (chunk: string) => {
        chunks += chunk
      },
    })
    let error: unknown
    try {
      await handshake.initialize({ clientInfo: CLIENT })
    } catch (error_: unknown) {
      error = error_
    }
    const exit = museExitOf(await handshake.close())
    return { failure: museStartFailure(error, stderrStartFault(chunks), exit), chunks }
  }

  it.skipIf(cli === undefined)('says a malformed file', async () => {
    const { failure } = await refused((file) => writeFile(file, 'not json {'))
    expect(failure).toHaveProperty('fault', 'authFile')
    expect(told(failure)).toContain(UI_TEXT.museStart.authFile)
  })

  it.skipIf(cli === undefined)('says a file that is a folder', async () => {
    const { failure } = await refused((file) => mkdir(file))
    expect(failure).toHaveProperty('fault', 'authFile')
  })

  it.skipIf(cli === undefined || process.getuid?.() === 0)(
    'says a file it may not read',
    async () => {
      const { failure } = await refused(async (file) => {
        await writeFile(file, '{ "providers": {}, "schema_version": 2 }')
        await chmod(file, 0o000)
      })
      expect(failure).toHaveProperty('fault', 'authFile')
    },
  )

  it.skipIf(cli === undefined)('says a schema version it does not know', async () => {
    const { failure } = await refused((file) =>
      writeFile(file, '{ "providers": {}, "schema_version": 99 }'),
    )
    expect(failure).toHaveProperty('fault', 'authSchema')
    expect(told(failure)).toContain('version 99')
  })
})

describe('what leaves the ACP boundary for a failed start', () => {
  it('lets each Muse Code start sentence through in full', () => {
    const cause = new ProtocolError('connection reached EOF')
    for (const failure of [
      museStartFailure(cause, { fault: 'authFile' }, undefined),
      museStartFailure(cause, { fault: 'authSchema', version: '99' }, undefined),
      museStartFailure(cause, undefined, { code: 3, signal: null }),
      museStartFailure(cause, undefined, { code: 127, signal: null }, 'linux'),
    ]) {
      expect(isMuseStartError(failure)).toBe(true)
      const message = told(failure)
      expect(message).toBe(`Internal error: ${(failure as MuseStartError).message}`)
      expect(message).not.toBe(UI_TEXT.actionFailed)
    }
  })

  it('lets the session and turn backstops through with their fixed-vocabulary cause', () => {
    expect(told(Object.assign(new Error('x'), { code: 'ENOTDIR' }))).toBe(
      `Internal error: ${fill(UI_TEXT.acpSessionStartFailed, { detail: 'Error ENOTDIR' })}`,
    )
    const turn = outboundError(
      toOutbound(
        RequestError.internalError(
          undefined,
          fill(UI_TEXT.acpTurnStartFailed, { detail: 'protocolViolation (MSP error -32600)' }),
        ),
      ).failure,
    )
    expect(turn.message).toContain('The turn could not be started (protocolViolation')
  })

  it('still flattens a start sentence whose slot holds more than a plain name', () => {
    for (const detail of [String.raw`C:\Users\someone\auth.json`, 'two\nlines', 'a'.repeat(65)]) {
      const wire = outboundError(
        toOutbound(
          RequestError.internalError(undefined, fill(UI_TEXT.acpSessionStartFailed, { detail })),
        ).failure,
      )
      expect(wire.message).toBe(UI_TEXT.actionFailed)
    }
    const museSlot = fill(UI_TEXT.museStart.exited, { code: String.raw`C:\Users\someone` })
    expect(
      outboundError(toOutbound(RequestError.internalError(undefined, museSlot)).failure).message,
    ).toBe(UI_TEXT.actionFailed)
  })
})

describe('isOpenableFolder', () => {
  it('is true for a folder, false for a file and for a name nothing has', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'openable-'))
    try {
      await writeFile(path.join(folder, 'file.txt'), 'x')
      expect(await isOpenableFolder(folder)).toBe(true)
      expect(await isOpenableFolder(path.join(folder, 'file.txt'))).toBe(false)
      expect(await isOpenableFolder(path.join(folder, 'file.txt', 'inside'))).toBe(false)
      expect(await isOpenableFolder(path.join(folder, 'nothing'))).toBe(false)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
