import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { McpConnection } from '../../src/core/backends/modelapi/mcp/connection'
import { setEnvironmentVariable } from '../../src/core/backends/musecode/launch'
import { type McpChildProcess, McpStdioTransport } from '../../src/core/backends/modelapi/mcp/stdio'
import {
  cmdQuoted,
  isExistingDirectory,
  isExistingFile,
  mcpServerEnvironment,
  mcpServerSpawner,
  observeMcpProcess,
  resolveServerCommand,
  spawnLine,
  type McpProcessHandle,
} from '../../src/host/backend/mcpProcess'
import { FakeLogOutputChannel } from './helpers/fakes'
import { isRunning } from './helpers/processes'
import { spawnMcpJob } from '../../src/host/backend/mcpJobLaunch'
import {
  FAKE_MCP_SERVER,
  fakeServerLaunch,
  fixtureJobLifecycle,
  realSpawner,
} from './helpers/mcpFixtures'

const HERE = path.dirname(FAKE_MCP_SERVER)
const ORPHAN_FIXTURE = path.join(HERE, 'fakeMcpOrphan.mjs')
const BINARY_FIXTURE = path.join(HERE, 'fakeMcpBinary.mjs')
const BATCH_FIXTURE = path.join(HERE, 'fakeMcpBatch.cmd')
const LAUNCHER_PARENT_FIXTURE = path.join(HERE, 'fakeMcpLauncherParent.mjs')
const PREBIND_PARENT_FIXTURE = path.join(HERE, 'fakeMcpPrebindParent.mjs')
const START_MARKER_FIXTURE = path.join(HERE, 'fakeMcpStartMarker.mjs')
const jobState = fixtureJobLifecycle()
beforeAll(jobState.setup, 60_000)
afterAll(jobState.dispose)

/** Node may report process exit before its final stdout bytes arrive. */
class OrderedProcess implements McpProcessHandle {
  private readonly exits = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()
  private readonly closes = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()
  private readonly errors = new Set<(error: Error) => void>()
  public readonly pid = undefined
  public exitCode: number | null = null
  public signalCode: NodeJS.Signals | null = null
  public readonly stdin = new PassThrough()
  public readonly stdout = new PassThrough()
  public readonly stderr = new PassThrough()

  public onProcessExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.exits.add(listener)
  }

  public onStreamsClose(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.closes.add(listener)
  }

  public onStartError(listener: (error: Error) => void): void {
    this.errors.add(listener)
  }

  public once(_event: 'exit', listener: () => void): void {
    this.exits.add(() => {
      listener()
    })
  }

  public kill(): boolean {
    return true
  }

  public processExited(): void {
    this.exitCode = 0
    for (const listener of this.exits) listener(0, null)
  }

  public streamsClosed(): void {
    for (const listener of this.closes) listener(0, null)
  }
}

it('keeps a final MCP response after process exit until stdout closes', async () => {
  const node = new OrderedProcess()
  const log = new FakeLogOutputChannel()
  const child = observeMcpProcess(
    node,
    {
      platform: 'win32',
      systemRoot: undefined,
      env: () => ({}),
      isExistingFile: () => false,
      isExistingDirectory: () => false,
      log: () => undefined,
    },
    Date.now(),
    true,
  )
  const transport = new McpStdioTransport(child, { name: 'ordered', framing: 'auto', log })
  const connection = new McpConnection(transport, { name: 'ordered', clientVersion: '1', log })
  let sent = ''
  node.stdin.on('data', (part: Buffer) => {
    sent += part.toString('utf8')
  })
  const pending = connection.initialize(1000)
  await vi.waitFor(() => {
    expect(sent).toContain('initialize')
  })
  const request: unknown = JSON.parse(sent.split('\n', 1)[0] ?? '')
  if (typeof request !== 'object' || request === null || !('id' in request)) {
    throw new Error('initialize request had no id')
  }
  node.processExited()
  node.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ordered' },
      },
    })}\n`,
  )
  await expect(pending).resolves.toBeUndefined()
  node.streamsClosed()
  await connection.close()
})

async function expectBinaryRoundtrip(child: McpChildProcess): Promise<void> {
  const output: Buffer[] = []
  const errors: Buffer[] = []
  child.onStdout((part) => {
    output.push(Buffer.from(part))
  })
  child.onStderr((part) => {
    errors.push(Buffer.from(part))
  })
  const exited = new Promise<string>((resolve) => {
    child.onExit(resolve)
  })
  const bytes = Buffer.from([0, 1, 2, 10, 13, 128, 255])
  child.write(bytes)
  child.endInput()
  expect(await exited).toBe('it exited with code 0')
  await vi.waitFor(() => {
    expect(Buffer.concat(output)).toEqual(bytes)
    expect(Buffer.concat(errors)).toEqual(Buffer.from([0, 255]))
  })
  await child.kill()
}

async function bundledJobLauncher(assemblyPath: string): Promise<string> {
  const bundle = path.join(path.dirname(assemblyPath), 'mcp-launcher-test.mjs')
  await build({
    entryPoints: [path.resolve('src/host/backend/mcpJobLaunch.ts')],
    outfile: bundle,
    platform: 'node',
    format: 'esm',
    bundle: true,
  })
  return bundle
}

/** A failed launch probe self-exits before its marker file is removed. */
async function didStartAndRemoveMarker(marker: string): Promise<boolean> {
  if (!existsSync(marker)) return false
  const pid = Number(readFileSync(marker, 'utf8'))
  await vi.waitFor(
    () => {
      expect(isRunning(pid)).toBe(false)
    },
    { timeout: 7000 },
  )
  await rm(marker, { force: true })
  return true
}

describe('mcpServerEnvironment (M50)', () => {
  it("passes only the allowlist of the host's environment, then the entry's own", () => {
    const env = mcpServerEnvironment(
      { PATH: '/bin', HOME: '/home/u', META_API_KEY: 'secret', AWS_SECRET: 'x', LANG: 'C' },
      { LANG: 'fr_FR', TOKEN: 't' },
      'linux',
    )
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/u', LANG: 'fr_FR', TOKEN: 't' })
  })

  it('reads the names in any case on Windows, keeping one spelling', () => {
    const env = mcpServerEnvironment(
      { Path: String.raw`C:\bin`, systemroot: String.raw`C:\Windows`, Secret: 'x' },
      { path: String.raw`C:\mine` },
      'win32',
    )
    expect(env).toEqual({ SystemRoot: String.raw`C:\Windows`, path: String.raw`C:\mine` })
  })
})

describe('resolveServerCommand (M50)', () => {
  const files = new Set([
    '/usr/bin/uvx',
    '/ws/bin/local-server',
    String.raw`C:\nodejs\npx.cmd`,
    String.raw`C:\nodejs\npx.exe`,
    String.raw`C:\tools\srv.bat`,
    String.raw`C:\ws\srv.exe`,
  ])
  const posix = { platform: 'linux' as const, isExistingFile: (file: string) => files.has(file) }
  const windows = { platform: 'win32' as const, isExistingFile: (file: string) => files.has(file) }

  it('finds a bare name on the absolute PATH entries only', () => {
    expect(resolveServerCommand('uvx', '/ws', { PATH: 'bin:/usr/bin' }, posix)).toBe('/usr/bin/uvx')
    expect(() => resolveServerCommand('local-server', '/ws', { PATH: 'bin:.' }, posix)).toThrow(
      'its command local-server was not found on the absolute entries of PATH',
    )
  })

  it('takes a path with a folder against the working directory, or as it is', () => {
    expect(resolveServerCommand('bin/local-server', '/ws', {}, posix)).toBe('/ws/bin/local-server')
    expect(resolveServerCommand('/usr/bin/uvx', '/ws', {}, posix)).toBe('/usr/bin/uvx')
    expect(() => resolveServerCommand('./missing', '/ws', {}, posix)).toThrow(
      'its command missing does not exist',
    )
  })

  it("tries Windows' launchable extensions in PATHEXT's order", () => {
    const env = { Path: String.raw`C:\nodejs;C:\tools`, PATHEXT: '.COM;.CMD;.EXE;.JS' }
    expect(resolveServerCommand('npx', String.raw`C:\ws`, env, windows)).toBe(
      String.raw`C:\nodejs\npx.cmd`,
    )
    expect(
      resolveServerCommand('npx', String.raw`C:\ws`, { Path: String.raw`C:\nodejs` }, windows),
    ).toBe(String.raw`C:\nodejs\npx.exe`)
    expect(resolveServerCommand('srv.bat', String.raw`C:\ws`, env, windows)).toBe(
      String.raw`C:\tools\srv.bat`,
    )
    expect(resolveServerCommand(String.raw`.\srv`, String.raw`C:\ws`, env, windows)).toBe(
      String.raw`C:\ws\srv.exe`,
    )
  })
})

describe('cmdQuoted and spawnLine (M50)', () => {
  it('quotes each part, doubling the backslashes before the closing quote', () => {
    expect(cmdQuoted('-y')).toBe('"-y"')
    expect(cmdQuoted('C:\\Program Files (x86)\\')).toBe(String.raw`"C:\Program Files (x86)\\"`)
    expect(cmdQuoted('a&b|c<d>e^f')).toBe('"a&b|c<d>e^f"')
  })

  it('refuses what cmd.exe would read as syntax inside quotes', () => {
    for (const part of ['say "hi"', '%PATH%', 'two\nlines', `nul${String.fromCodePoint(0)}`]) {
      expect(() => cmdQuoted(part), part).toThrow('start its program directly')
    }
  })

  it('starts a batch file through cmd.exe, and anything else as it is', () => {
    expect(
      spawnLine(String.raw`C:\nodejs\npx.cmd`, ['-y', 'pkg'], {
        platform: 'win32',
        systemRoot: String.raw`C:\Windows`,
      }),
    ).toEqual({
      file: String.raw`C:\Windows\System32\cmd.exe`,
      args: ['/d', '/v:off', '/s', '/c', String.raw`""C:\nodejs\npx.cmd" "-y" "pkg""`],
      isVerbatim: true,
    })
    expect(
      spawnLine(String.raw`C:\nodejs\node.exe`, ['a'], {
        platform: 'win32',
        systemRoot: String.raw`C:\W`,
      }),
    ).toEqual({
      file: String.raw`C:\nodejs\node.exe`,
      args: ['a'],
      isVerbatim: false,
    })
    expect(
      spawnLine('/usr/bin/run.cmd', [], { platform: 'linux', systemRoot: undefined }).isVerbatim,
    ).toBe(false)
    expect(() =>
      spawnLine(String.raw`C:\x.bat`, [], { platform: 'win32', systemRoot: undefined }),
    ).toThrow('SystemRoot is not set')
  })
})

describe('the file probes (M50)', () => {
  it('tell a file from a folder from nothing', () => {
    expect(isExistingFile(FAKE_MCP_SERVER)).toBe(true)
    expect(isExistingFile(HERE)).toBe(false)
    expect(isExistingDirectory(HERE)).toBe(true)
    expect(isExistingDirectory(FAKE_MCP_SERVER)).toBe(false)
    expect(isExistingFile(path.join(HERE, 'missing'))).toBe(false)
    expect(isExistingDirectory(path.join(HERE, 'missing'))).toBe(false)
  })
})

function textOf(content: readonly unknown[] | undefined): string {
  const [block] = content ?? []
  return typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : ''
}

// Real child processes: on a loaded machine Node itself can take seconds to start.
describe('mcpServerSpawner (M50)', { timeout: 60_000 }, () => {
  const closing: McpConnection[] = []
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((connection) => connection.close()))
  }, 60_000)

  function start(env: Record<string, string> = {}, cwd = HERE) {
    const log = new FakeLogOutputChannel()
    const child = realSpawner(log, jobState.path)(fakeServerLaunch(env), cwd)
    const exits: string[] = []
    child.onExit((how) => {
      exits.push(how)
    })
    const transport = new McpStdioTransport(child, { name: 'fake', framing: 'auto', log })
    const connection = new McpConnection(transport, { name: 'fake', clientVersion: '1', log })
    closing.push(connection)
    return { child, connection, exits, log }
  }

  it.skipIf(process.platform !== 'win32')(
    'starts the prepared MCP executable directly',
    async () => {
      if (jobState.path === undefined || process.env['SystemRoot'] === undefined) {
        throw new Error('Windows MCP job fixture unavailable')
      }
      const helper = spawnMcpJob({
        executablePath: jobState.path,
        file: process.execPath,
        args: [BINARY_FIXTURE],
        isVerbatim: false,
        cwd: HERE,
        env: { SystemRoot: process.env['SystemRoot'], Path: process.env['Path'] },
        log: () => undefined,
      })
      const closed = once(helper, 'close')
      try {
        expect(helper.spawnfile).toBe(jobState.path)
      } finally {
        helper.kill()
        await closed
      }
    },
  )

  it('starts the server in its folder with the allowlisted environment and its own', async () => {
    const { connection } = start({ FAKE_MCP_MARK: 'yes' })
    await connection.initialize(10_000)
    const result = await connection.callTool('env', {}, { timeoutMs: 10_000 })
    const seen: unknown = JSON.parse(textOf(result.content))
    expect(seen).toMatchObject({ names: expect.arrayContaining(['FAKE_MCP_MARK']) as unknown })
    expect(JSON.stringify(seen)).not.toContain('META_API_KEY')
    if (process.platform === 'win32') {
      expect(JSON.stringify(seen)).not.toContain('MUSE_SPARK_MCP_JOB_CONFIG')
      expect(JSON.stringify(seen)).not.toContain('PSModulePath')
    }
    expect(seen).toMatchObject({ cwd: expect.stringMatching(/helpers$/) as unknown })
  })

  it('receives a real server’s final response before its immediate exit closes stdio', async () => {
    const { connection, exits } = start()
    await connection.initialize(10_000)
    const result = await connection.callTool('final_then_exit', {}, { timeoutMs: 10_000 })
    expect(textOf(result.content)).toBe('final reply')
    await vi.waitFor(() => {
      expect(exits).toHaveLength(1)
    })
  })

  it('passes binary stdin, stdout and stderr without a text relay', async () => {
    const log = new FakeLogOutputChannel()
    const child = realSpawner(log, jobState.path)(
      { ...fakeServerLaunch(), args: [BINARY_FIXTURE] },
      HERE,
    )
    await expectBinaryRoundtrip(child)
  })

  it.skipIf(process.platform !== 'win32')(
    'keeps binary stdio intact through a Windows batch launcher',
    async () => {
      const log = new FakeLogOutputChannel()
      const child = realSpawner(log, jobState.path)(
        {
          ...fakeServerLaunch(),
          command: BATCH_FIXTURE,
          args: [],
          env: { M50_NODE_EXE: process.execPath, M50_BINARY_FIXTURE: BINARY_FIXTURE },
        },
        HERE,
      )
      await expectBinaryRoundtrip(child)
    },
  )

  it.skipIf(process.platform !== 'win32')(
    'ends the job and detached grandchild when the owning Node process exits',
    async () => {
      if (jobState.path === undefined) throw new Error('Windows job executable missing')
      const bundle = await bundledJobLauncher(jobState.path)
      const owner = spawn(process.execPath, [LAUNCHER_PARENT_FIXTURE], {
        env: {
          ...process.env,
          M50_JOB_BUNDLE: bundle,
          M50_JOB_EXECUTABLE: jobState.path,
          M50_JOB_ORPHAN: ORPHAN_FIXTURE,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let output = ''
      let error = ''
      owner.stdout.on('data', (part: Buffer) => {
        output += part.toString('utf8')
      })
      owner.stderr.on('data', (part: Buffer) => {
        error += part.toString('utf8')
      })
      const code = await new Promise<number | null>((resolve) => owner.once('exit', resolve))
      expect(code, error).toBe(0)
      const observed: unknown = JSON.parse(output)
      if (
        typeof observed !== 'object' ||
        observed === null ||
        !('helperPid' in observed) ||
        !('orphanPid' in observed) ||
        typeof observed.helperPid !== 'number' ||
        typeof observed.orphanPid !== 'number'
      ) {
        throw new Error('launcher owner did not report fixture process ids')
      }
      const { helperPid, orphanPid } = observed
      await vi.waitFor(
        () => {
          expect(isRunning(helperPid)).toBe(false)
          expect(isRunning(orphanPid)).toBe(false)
        },
        { timeout: 4000 },
      )
    },
    15_000,
  )

  it.skipIf(process.platform !== 'win32')(
    'never resumes a server when the creating Node process dies before binding',
    async () => {
      if (jobState.path === undefined) throw new Error('Windows job executable missing')
      const bundle = await bundledJobLauncher(jobState.path)
      const marker = path.join(path.dirname(jobState.path), 'prebind-parent.marker')
      const owner = spawn(process.execPath, [PREBIND_PARENT_FIXTURE], {
        env: {
          ...process.env,
          M50_JOB_BUNDLE: bundle,
          M50_JOB_EXECUTABLE: jobState.path,
          M50_JOB_MARKER_FIXTURE: START_MARKER_FIXTURE,
          M50_JOB_MARKER: marker,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let output = ''
      owner.stdout.on('data', (part: Buffer) => {
        output += part.toString('utf8')
      })
      const code = await new Promise<number | null>((resolve) => owner.once('exit', resolve))
      expect(code).toBe(0)
      const observed: unknown = JSON.parse(output)
      if (
        typeof observed !== 'object' ||
        observed === null ||
        !('helperPid' in observed) ||
        typeof observed.helperPid !== 'number'
      ) {
        throw new Error('prebind owner did not report its helper id')
      }
      const { helperPid } = observed
      await vi.waitFor(
        () => {
          expect(isRunning(helperPid)).toBe(false)
        },
        { timeout: 7000 },
      )
      const wasStarted = await didStartAndRemoveMarker(marker)
      expect(wasStarted).toBe(false)
    },
    17_000,
  )

  it.skipIf(process.platform !== 'win32')(
    'never starts a server when the owner withholds GO after the helper binds its handle',
    async () => {
      if (jobState.path === undefined || process.env['SystemRoot'] === undefined) {
        throw new Error('Windows job fixture unavailable')
      }
      const marker = path.join(path.dirname(jobState.path), 'withheld-go.marker')
      const pipeName = `muse-mcp-withheld-${randomUUID()}`
      const nonce = randomUUID().replaceAll('-', '')
      let isBound = false
      const control = createServer((socket) => {
        socket.on('data', (bytes: Buffer) => {
          if (bytes.toString('utf8') !== `READY ${nonce}\n`) return
          isBound = true
          socket.end()
        })
      })
      await new Promise<void>((resolve) => {
        control.listen(`\\\\.\\pipe\\${pipeName}`, resolve)
      })
      const childEnv = {
        SystemRoot: process.env['SystemRoot'],
        Path: process.env['Path'],
        TEMP: process.env['TEMP'],
        M50_START_MARKER: marker,
      }
      const payload = Buffer.from(
        JSON.stringify({
          file: process.execPath,
          args: [START_MARKER_FIXTURE],
          cwd: HERE,
          env: childEnv,
          parentPid: process.pid,
          isVerbatim: false,
          controlPipe: pipeName,
          controlNonce: nonce,
        }),
      ).toString('base64')
      const helperEnv = { ...childEnv }
      setEnvironmentVariable(helperEnv, 'win32', 'MUSE_SPARK_MCP_JOB_CONFIG', payload)
      const helper = spawn(jobState.path, [], {
        cwd: HERE,
        env: helperEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      try {
        const code = await new Promise<number | null>((resolve) => helper.once('exit', resolve))
        expect(existsSync(marker)).toBe(false)
        expect(isBound).toBe(true)
        expect(code).toBe(1)
      } finally {
        control.close()
        if (helper.exitCode === null && helper.signalCode === null) helper.kill()
        await didStartAndRemoveMarker(marker)
      }
    },
    15_000,
  )

  it('refuses a working directory that is not there', () => {
    expect(() => start({}, path.join(HERE, 'missing'))).toThrow('does not exist')
  })

  it.skipIf(process.platform !== 'win32')(
    'fails closed when its job executable is unavailable',
    () => {
      const launcher = mcpServerSpawner({
        platform: 'win32',
        systemRoot: process.env['SystemRoot'],
        env: () => process.env,
        isExistingFile,
        isExistingDirectory,
        log: () => undefined,
      })
      expect(() => launcher(fakeServerLaunch(), HERE)).toThrow(
        'Windows job containment is unavailable; the MCP server was not started',
      )
    },
  )

  it('says how a server that could not start ended', async () => {
    // A program that was there when it was looked for and gone when it was started.
    const spawn = mcpServerSpawner({
      platform: process.platform,
      systemRoot: process.env['SystemRoot'],
      jobExecutablePath: jobState.path,
      env: () => process.env,
      isExistingFile: () => true,
      isExistingDirectory,
      log: () => undefined,
    })
    const child: McpChildProcess = spawn(
      { ...fakeServerLaunch(), command: path.join(HERE, 'vanished.exe'), args: [] },
      HERE,
    )
    let stderr = ''
    child.onStderr((bytes) => {
      stderr += Buffer.from(bytes).toString('utf8')
    })
    const how = await new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    if (process.platform === 'win32') {
      expect(how).toBe('it exited with code 1')
      await vi.waitFor(() => {
        expect(stderr).toContain('MCP launcher Win32 error 2')
      })
    } else {
      expect(how).toMatch(/^it could not be started: spawn .*ENOENT/)
    }
    child.write(new Uint8Array([1]))
    const again = await new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    expect(again).toBe(how)
  })

  it('lets a server leave when its input closes, and kills one that stays', async () => {
    const polite = start()
    await polite.connection.initialize(10_000)
    const stubborn = start({ FAKE_MCP_IGNORE_EOF: '1' })
    await stubborn.connection.initialize(10_000)
    closing.length = 0
    await Promise.all([polite.connection.close(), stubborn.connection.close()])
    expect(polite.exits).toEqual(['it exited with code 0'])
    // The kill's own wait may end before the exit is reported on a busy machine.
    await vi.waitFor(
      () => {
        expect(stubborn.exits).toHaveLength(1)
      },
      { timeout: 30_000 },
    )
    expect(stubborn.exits[0]).not.toBe('it exited with code 0')
  })

  it('reaps a child whose MCP parent exited before close (M50)', async () => {
    const log = new FakeLogOutputChannel()
    const child = realSpawner(log, jobState.path)(
      { ...fakeServerLaunch(), args: [ORPHAN_FIXTURE] },
      HERE,
    )
    let output = ''
    let orphanPid: number | undefined
    child.onStderr((chunk) => {
      output += Buffer.from(chunk).toString('utf8')
      const match = /ORPHAN_PID=(\d+)/.exec(output)
      if (match?.[1] !== undefined) {
        orphanPid = Number(match[1])
      }
    })
    const parentExited = new Promise<string>((resolve) => {
      child.onExit(resolve)
    })
    const transport = new McpStdioTransport(child, { name: 'orphan', framing: 'auto', log })
    try {
      await vi.waitFor(
        () => {
          expect(orphanPid).toBeDefined()
        },
        { timeout: 10_000 },
      )
      const pid = orphanPid
      if (pid === undefined) {
        throw new Error('the MCP child PID was not reported')
      }
      expect(isRunning(pid)).toBe(true)
      child.write(Buffer.from('exit\n'))
      await parentExited
      await transport.close()
      await vi.waitFor(
        () => {
          expect(isRunning(pid)).toBe(false)
        },
        { timeout: 5000 },
      )
    } finally {
      // The fixture's child self-exits even on a regression: wait for that
      // instead of signalling an unverified PID in a failed test.
      const cleanupPid = orphanPid
      if (cleanupPid !== undefined) {
        await vi.waitFor(
          () => {
            expect(isRunning(cleanupPid)).toBe(false)
          },
          { timeout: 20_000 },
        )
      }
    }
  }, 30_000)
})
