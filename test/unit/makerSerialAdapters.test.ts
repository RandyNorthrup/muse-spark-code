import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { querySerialPortUse } from '../../src/core/maker/serial/portUse'
import { prepareWindowsSerialHelper } from '../../src/core/maker/serial/windowsHelper'
import { makerProcessDeps } from './helpers/makerSerial'

const directories: string[] = []
function runForResult(file: string, args: readonly string[]) {
  return new Promise<{ code: number; stdout: string }>((resolveRun) => {
    execFile(file, [...args], { windowsHide: true }, (error, stdout) => {
      let code = 1
      if (error === null) code = 0
      else if (typeof error.code === 'number') code = error.code
      resolveRun({ code, stdout })
    })
  })
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('serial platform metadata and helper build', () => {
  it('clears POSIX terminal exclusivity only when this descriptor acquired it', async () => {
    const script = `
import sys, types, runpy, json
calls = []
fcntl = types.ModuleType('fcntl')
fcntl.LOCK_EX = 2
fcntl.LOCK_NB = 4
termios = types.ModuleType('termios')
termios.TIOCEXCL = 1
termios.TIOCNXCL = 2
sys.modules['fcntl'] = fcntl
sys.modules['termios'] = termios
helper = runpy.run_path(sys.argv[1])
args = types.SimpleNamespace(port='fake', poll_ms=1, baud=1, dtr='0', rts='0')
scenarios = {}
for mode, fail_at in [('raw', 'flock'), ('raw', 'claim'), ('raw', 'clear'), ('serial', 'claim'), ('serial', 'clear')]:
    calls.clear()
    def flock(fd, flags):
        calls.append('flock')
        if fail_at == 'flock': raise BlockingIOError()
    def ioctl(fd, flag):
        word = 'claim' if flag == termios.TIOCEXCL else 'clear'
        calls.append(word)
        if fail_at == word: raise OSError()
    fcntl.flock = flock
    fcntl.ioctl = ioctl
    class Port:
        def open(self): calls.append('open')
        def close(self): calls.append('close')
        def fileno(self): return 1
        def read(self, count): return b''
        def write(self, data): pass
    sys.modules['serial'] = types.SimpleNamespace(Serial=Port)
    namespace = helper[mode].__globals__
    namespace['os'] = types.SimpleNamespace(O_RDWR=1, O_NOCTTY=2, O_NONBLOCK=4,
        open=lambda *args: calls.append('open') or 1,
        close=lambda fd: calls.append('close'))
    namespace['transfer'] = lambda *args: calls.append('transfer')
    try: helper[mode](args)
    except OSError: pass
    scenarios[mode + '-' + fail_at] = list(calls)
print(json.dumps(scenarios))`
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.platform === 'win32' ? 'python.exe' : '/usr/bin/python3',
        ['-I', '-c', script, path.resolve('native/posix/serial.py')],
        { env: makerProcessDeps().env, timeout: 20_000, windowsHide: true },
        (error, output) => {
          if (error === null) resolve(output)
          else reject(new Error('test-python-failed', { cause: error }))
        },
      )
    })
    expect(JSON.parse(stdout)).toEqual({
      'raw-flock': ['open', 'flock', 'close'],
      'raw-claim': ['open', 'flock', 'claim', 'close'],
      'raw-clear': ['open', 'flock', 'claim', 'transfer', 'clear', 'close'],
      'serial-claim': ['open', 'claim', 'close'],
      'serial-clear': ['open', 'claim', 'transfer', 'clear', 'close'],
    })
  })

  it('reports existing users without opening the port and fails closed on unknown results', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm103-portuse-'))
    directories.push(directory)
    // Real tiny programs stand in for fuser/lsof: each records its argv and
    // answers with the exit code and output of its case.
    const program = async (name: string, body: string) => {
      const file = path.join(directory, name)
      await writeFile(file, `#!/bin/sh\nprintf '%s' "$@" > "${file}.args"\n${body}\n`, {
        mode: 0o755,
      })
      return file
    }
    const run = runForResult
    const busy = await program('busy', String.raw`printf ' 1234 4567\n'`)
    const deps = { platform: 'linux', executable: busy, maxBytes: 128, run } as const
    expect(await querySerialPortUse({ port: '/dev/ttyACM0' }, deps)).toBe('busy')
    expect(await readFile(`${busy}.args`, 'utf8')).toBe('--/dev/ttyACM0')
    const free = await program('free', 'exit 1')
    expect(
      await querySerialPortUse(
        { port: '/dev/cu.test' },
        { ...deps, platform: 'darwin', executable: free },
      ),
    ).toBe('free')
    expect(await readFile(`${free}.args`, 'utf8')).toBe('-t--/dev/cu.test')
    const unknownBodies = ['exit 2', "printf 'permission error'", "printf '1234'; exit 1"]
    for (const [index, body] of unknownBodies.entries()) {
      const executable = await program(`unknown${String(index)}`, body)
      await expect(
        querySerialPortUse({ port: '/dev/ttyACM0' }, { ...deps, executable }),
      ).rejects.toThrow('serial-port-use-unknown')
    }
    const oversize = await program('oversize', `printf '%0129d' 1`)
    await expect(
      querySerialPortUse({ port: '/dev/ttyACM0' }, { ...deps, executable: oversize }),
    ).rejects.toThrow('serial-port-use-oversize')
  })

  it('does not turn failed compilation into a successful helper', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm103-build-'))
    directories.push(directory)
    await expect(
      prepareWindowsSerialHelper({
        directory,
        systemRoot: 'root',
        readSource: () => Promise.resolve('source'),
        run: () => Promise.reject(new Error('test-compiler-failure')),
        env: {},
        log: () => undefined,
      }),
    ).rejects.toThrow('test-compiler-failure')
    expect(await readdir(directory)).toEqual([])
  })
})
