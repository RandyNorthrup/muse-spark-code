import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { querySerialPortUse } from '../../src/core/maker/serial/portUse'
import { prepareWindowsSerialHelper } from '../../src/core/maker/serial/windowsHelper'
import type { RunProgram } from '../../src/host/processTree'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('serial platform metadata and helper build', () => {
  it('reports existing users without opening the port and fails closed on unknown results', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: ' 1234 4567\n' })
    const deps = { platform: 'linux', executable: '/usr/bin/fuser', maxBytes: 128, run } as const
    expect(await querySerialPortUse({ port: '/dev/ttyACM0' }, deps)).toBe('busy')
    expect(run).toHaveBeenCalledExactlyOnceWith('/usr/bin/fuser', ['--', '/dev/ttyACM0'])
    run.mockResolvedValue({ code: 1, stdout: '' })
    expect(
      await querySerialPortUse(
        { port: '/dev/cu.test' },
        { ...deps, platform: 'darwin', executable: '/usr/sbin/lsof' },
      ),
    ).toBe('free')
    expect(run.mock.calls.at(-1)).toEqual(['/usr/sbin/lsof', ['-t', '--', '/dev/cu.test']])
    for (const result of [
      { code: 2, stdout: '' },
      { code: 0, stdout: 'permission error' },
      { code: 1, stdout: '1234' },
    ]) {
      run.mockResolvedValue(result)
      await expect(querySerialPortUse({ port: '/dev/ttyACM0' }, deps)).rejects.toThrow(
        'serial-port-use-unknown',
      )
    }
    run.mockResolvedValue({ code: 0, stdout: '1'.repeat(129) })
    await expect(querySerialPortUse({ port: '/dev/ttyACM0' }, deps)).rejects.toThrow(
      'serial-port-use-oversize',
    )
  })

  it('compiles shipped C# once with framework references and the supplied environment', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm103-build-'))
    directories.push(directory)
    const source = await readFile(path.resolve('native/windows/MuseSparkSerial.cs'), 'utf8')
    const readSource = vi.fn(() => Promise.resolve(source))
    const run = vi.fn<RunProgram>(async (_file, args) => {
      const output = args.find((arg) => arg.startsWith('/out:'))!
      await writeFile(output.slice('/out:'.length), 'test executable')
      expect(await readFile(args.at(-1)!, 'utf8')).toBe(source)
      return ''
    })
    const env = { PATH: 'test-path' }
    const deps = {
      directory,
      systemRoot: String.raw`C:\Windows`,
      readSource,
      run,
      env,
      log: vi.fn(),
    }
    const target = await prepareWindowsSerialHelper(deps)
    expect(path.basename(target)).toMatch(/^MuseSparkSerial-[\da-f]+\.exe$/)
    expect(await prepareWindowsSerialHelper(deps)).toBe(target)
    expect(run).toHaveBeenCalledTimes(1)
    const call = run.mock.calls[0]!
    expect(call[0]).toBe(String.raw`C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe`)
    expect(call[1]).toContain('/target:exe')
    expect(call[1]).toContain(
      String.raw`/reference:C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Web.Extensions.dll`,
    )
    expect(call[2]).toBe(env)
    expect(await readdir(directory)).toEqual([path.basename(target)])
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
        log: vi.fn(),
      }),
    ).rejects.toThrow('test-compiler-failure')
    expect(await readdir(directory)).toEqual([])
  })
})
