import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { superviseRuntime, stopWorkspace } from '../../src/runtime/lsp/supervisor'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { removeFolder } from './helpers/temporaryFolders'

const directory = await mkdtemp(path.join(tmpdir(), 'muse-supervisor-test-'))
afterAll(() => removeFolder(directory))

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitFor(file: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await readFile(file, 'utf8')
    } catch {
      await pause(25)
    }
  }
  throw new Error(`no receipt: ${file}`)
}

function start(cwd: string, source: string, args: readonly string[] = []) {
  const stdout = new PassThrough()
  stdout.resume()
  const stdin = new PassThrough()
  const done = superviseRuntime({
    registry: path.join(directory, 'owners'),
    cwd,
    file: process.execPath,
    args: ['-e', source, ...args],
    env: {
      PATH: process.env['PATH'],
      SystemRoot: process.env['SystemRoot'],
      M104_API_KEY: 'fake-sentinel',
    },
    packageRoot: process.cwd(),
    stdin,
    stdout,
  })
  // Observe immediately even when startup fails; the test still awaits the result.
  void done.catch(() => undefined)
  return { stdout, stdin, done }
}

describe('M104H2 runtime supervision', () => {
  it('parses Stop separately and refuses recursive supervisors', () => {
    expect(parseCommandLine(['stop'])).toEqual({ command: 'stop' })
    expect(parseCommandLine(['stop', 'extra'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['supervise', '--backend', 'modelApi'])).toEqual({
      command: 'supervise',
      args: ['--backend', 'modelApi'],
    })
    expect(parseCommandLine(['supervise', 'supervise'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['supervise', 'stop'])).toMatchObject({ command: 'invalid' })
  })

  it('preserves binary stdio and child exit status, stripping credentials', async () => {
    const run = start(
      directory,
      `
      if ('M104_API_KEY' in process.env) process.exit(9);
      process.stderr.write('private test account');
      process.stdin.pipe(process.stdout);
    `,
    )
    const chunks: Buffer[] = []
    run.stdout.on('data', (bytes: Buffer) => {
      chunks.push(bytes)
    })
    const bytes = Buffer.from([0, 128, 255, 10, 13, 0])
    run.stdin.end(bytes)
    expect(await run.done).toBe(0)
    expect(Buffer.concat(chunks)).toEqual(bytes)
    const failed = start(directory, 'process.exit(7)')
    expect(await failed.done).toBe(7)
    expect(await readdir(path.join(directory, 'owners'))).toEqual([])
  })

  it('fails explicitly when the configured child cannot start', async () => {
    await expect(
      superviseRuntime({
        registry: path.join(directory, 'owners'),
        cwd: directory,
        file: path.join(directory, 'missing'),
        args: [],
        env: process.env,
        packageRoot: process.cwd(),
        stdin: new PassThrough(),
        stdout: new PassThrough(),
      }),
    ).resolves.toBe(1)
  })

  it('Stop kills a busy TERM-ignoring root and grandchild, waits for both, and isolates workspaces', async () => {
    const ready = path.join(directory, 'ready.json')
    const otherReady = path.join(directory, 'other.ready')
    const other = start(
      tmpdir(),
      `
      require('node:fs').writeFileSync(process.argv[1], 'ready');
      setInterval(() => {}, 1000);
    `,
      [otherReady],
    )
    const busy = start(
      directory,
      `
      const {spawn}=require('node:child_process');
      const grandchild=spawn(process.execPath,['-e', "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1]+'.grandchild','ready');setInterval(()=>{},1000)",process.argv[1]],{stdio:'ignore'});
      process.on('SIGTERM',()=>{});
      require('node:fs').writeFileSync(process.argv[1],JSON.stringify([process.pid,grandchild.pid]));
      for(;;){}
    `,
      [ready],
    )
    const pids: unknown = JSON.parse(await waitFor(ready))
    expect(Array.isArray(pids)).toBe(true)
    await waitFor(otherReady)
    await waitFor(`${ready}.grandchild`)
    const started = Date.now()
    try {
      await stopWorkspace(path.join(directory, 'owners'), directory)
      expect(await busy.done).toBe(0)
      expect(Date.now() - started).toBeLessThan(11_000)
      if (Array.isArray(pids)) {
        for (const pid of pids) {
          if (typeof pid !== 'number') throw new Error('invalid test pid')
          expect(() => process.kill(pid, 0)).toThrow()
        }
      }
      expect(await readdir(path.join(directory, 'owners'))).toHaveLength(1)
    } finally {
      if (Array.isArray(pids) && typeof pids[0] === 'number' && process.platform !== 'win32') {
        try {
          process.kill(-pids[0], 'SIGKILL')
        } catch {
          /* The owned test group may already be gone. */
        }
      }
      try {
        await busy.done
      } catch {
        /* A red drill may deliberately make Stop fail. */
      }
      await stopWorkspace(path.join(directory, 'owners'), tmpdir())
      await other.done
    }
  })

  it.runIf(process.platform !== 'win32')(
    'does not acknowledge Stop until the process group has exited',
    async () => {
      const ready = path.join(directory, 'group.ready')
      const run = start(
        directory,
        `require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
        [ready],
      )
      await waitFor(ready)
      const nativeKill = process.kill.bind(process)
      let isGroupReleased = false
      const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        return (signal === 0 && !isGroupReleased && pid < 0) || nativeKill(pid, signal)
      })
      let didStop = false
      const stopping = (async () => {
        await stopWorkspace(path.join(directory, 'owners'), directory)
        didStop = true
      })()
      void stopping.catch(() => undefined)
      try {
        await pause(750)
        expect(didStop).toBe(false)
        isGroupReleased = true
        await stopping
        expect(await run.done).toBe(0)
      } finally {
        isGroupReleased = true
        kill.mockRestore()
        await stopping
        await run.done
      }
    },
  )

  it('refuses a wrong control token without stopping the owner', async () => {
    const ready = path.join(directory, 'authorized.ready')
    const run = start(
      directory,
      `require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)`,
      [ready],
    )
    const pid = Number(await waitFor(ready))
    const owners = await readdir(path.join(directory, 'owners'))
    const file = owners[0]!
    const recordText = await readFile(path.join(directory, 'owners', file), 'utf8')
    const record: unknown = JSON.parse(recordText)
    if (
      typeof record !== 'object' ||
      record === null ||
      !('pipe' in record) ||
      typeof record.pipe !== 'string' ||
      !('token' in record) ||
      typeof record.token !== 'string'
    )
      throw new Error('invalid test record')
    const pipe = record.pipe
    expect(pipe).not.toContain(record.token)
    let lingering: ReturnType<typeof createConnection> | undefined
    try {
      const socket = createConnection(pipe)
      await new Promise<void>((resolve, reject) => {
        socket.resume()
        socket.setTimeout(1000, () => {
          socket.destroy(new Error('test control did not close'))
        })
        socket.on('error', reject)
        socket.on('connect', () => {
          socket.write('wrong-token\n')
        })
        socket.on('close', resolve)
      })
      expect(() => process.kill(pid, 0)).not.toThrow()
      await new Promise<void>((resolve, reject) => {
        const oversized = createConnection(pipe)
        oversized.setTimeout(1000, () => {
          oversized.destroy(new Error('test frame cap did not fire'))
        })
        oversized.on('error', reject)
        oversized.on('connect', () => {
          oversized.write('x'.repeat(100))
        })
        oversized.on('close', (failed) => {
          if (!failed) resolve()
        })
      })
      expect(await readdir(path.join(directory, 'owners'))).toHaveLength(1)
      if (process.platform !== 'win32') {
        const info = await stat(path.join(directory, 'owners', file))
        expect(info.mode & 0o777).toBe(0o600)
      }
      lingering = createConnection(pipe)
      await new Promise<void>((resolve, reject) => {
        lingering?.on('error', reject)
        lingering?.on('connect', () => {
          lingering?.write('partial')
          resolve()
        })
      })
    } finally {
      const started = Date.now()
      try {
        await stopWorkspace(path.join(directory, 'owners'), directory)
        await run.done
        expect(Date.now() - started).toBeLessThan(2000)
      } finally {
        lingering?.destroy()
      }
    }
  })

  it('rejects malformed and oversized ownership records before dialing', async () => {
    const registry = path.join(directory, 'owners')
    const record = path.join(registry, `${workspaceKey(directory)}-bad.json`)
    try {
      await writeFile(record, JSON.stringify({ pipe: 'bad', token: 'short' }))
      await expect(stopWorkspace(registry, directory)).rejects.toThrow()
      await writeFile(record, 'x'.repeat(4096))
      await expect(stopWorkspace(registry, directory)).rejects.toThrow('ESTOP_RECORD')
    } finally {
      await removeFolder(record)
    }
    await expect(stopWorkspace(path.join(directory, 'absent'), directory)).resolves.toBeUndefined()
  })
})
