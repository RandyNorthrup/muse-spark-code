import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { windowsVaultExecutable } from '../../src/host/vault/slots/windowsVaultBuild'
import { windowsVaultTransport } from '../../src/runtime/vault/slots/windowsVaultTransport'
import { UI_TEXT, VAULT_APPROVAL_TTL_MS, VAULT_LIMITS } from '../../src/shared/constants'
import type { RunProgram } from '../../src/host/processTree'

const processStub = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }))
vi.mock('node:child_process', () => processStub)
const folders: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.resetAllMocks()
  for (const folder of folders) await rm(folder, { recursive: true, force: true })
  folders.length = 0
})
function child() {
  const instance = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  })
  processStub.spawn.mockReturnValue(instance)
  return instance
}
const helper = path.resolve('temp/MuseSparkVault.exe')
const header = Buffer.from(JSON.stringify({ v: 1, operation: 'probe' }))

describe('Windows helper private transport', () => {
  it('uses empty argv/environment, hidden console and binary stdin only', async () => {
    const instance = child()
    const input: Buffer[] = []
    instance.stdin.on('data', (bytes: Buffer) => {
      input.push(bytes)
    })
    const key = Buffer.alloc(32, 42)
    const wrapHeader = Buffer.from(
      JSON.stringify({
        v: 1,
        operation: 'wrap',
        identity: { slotId: '1'.repeat(32), vaultId: '2'.repeat(32), tier: 'osStore' },
        title: 'test',
        use: 'test',
      }),
    )
    const pending = windowsVaultTransport(helper).exchange(wrapHeader, key)
    expect(processStub.spawn).toHaveBeenCalledWith(helper, [], {
      env: {},
      stdio: 'pipe',
      shell: false,
      windowsHide: true,
    })
    const raw = Buffer.concat(input)
    expect(raw.readUInt32BE()).toBe(wrapHeader.length)
    expect(raw.subarray(4, 4 + wrapHeader.length)).toEqual(wrapHeader)
    expect(raw.subarray(4 + wrapHeader.length)).toEqual(key)
    const chunk = Buffer.from('private helper output')
    instance.stdout.emit('data', chunk)
    const stderr = Buffer.from('do not relay an account or key')
    instance.stderr.emit('data', stderr)
    instance.emit('close', 0)
    const output = await pending
    expect(Buffer.from(output).toString()).toBe('private helper output')
    expect(chunk.every((value) => value === 0)).toBe(true)
    expect(stderr.every((value) => value === 0)).toBe(true)
    raw.fill(0)
    key.fill(0)
    output.fill(0)
  })
  it('rejects relative paths and non-executable targets', () => {
    expect(() => windowsVaultTransport('helper.exe')).toThrow(UI_TEXT.vault.noAccess)
    expect(() => windowsVaultTransport(path.resolve('helper.cmd'))).toThrow(UI_TEXT.vault.noAccess)
    expect(processStub.spawn).not.toHaveBeenCalled()
  })
  it('refuses malformed headers and pre-aborted calls without spawning', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(
      windowsVaultTransport(helper, abort.signal).exchange(header, new Uint8Array()),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    await expect(
      windowsVaultTransport(helper).exchange(Buffer.from('malformed'), new Uint8Array()),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    await expect(
      windowsVaultTransport(helper).exchange(
        Buffer.from('{"v":2,"operation":"probe"}'),
        new Uint8Array(),
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(processStub.spawn).not.toHaveBeenCalled()
  })
  it.each(['process', 'stdin', 'exit', 'abort', 'timeout'] as const)(
    'terminates on %s failure, erases chunks and keeps diagnostics private',
    async (fault) => {
      vi.useFakeTimers()
      const instance = child()
      const controller = new AbortController()
      const pending = windowsVaultTransport(helper, controller.signal).exchange(
        header,
        new Uint8Array(),
      )
      const rejection = expect(pending).rejects.toThrow(UI_TEXT.vault.noAccess)
      const chunk = Buffer.from('private value')
      instance.stdout.emit('data', chunk)
      switch (fault) {
        case 'process': {
          instance.emit('error', new Error('private process diagnostic'))
          break
        }
        case 'stdin': {
          instance.stdin.emit('error', new Error('private pipe diagnostic'))
          break
        }
        case 'exit': {
          instance.emit('close', 1)
          break
        }
        case 'abort': {
          controller.abort()
          break
        }
        case 'timeout': {
          {
            await vi.advanceTimersByTimeAsync(VAULT_APPROVAL_TTL_MS)
            // No default
          }
          break
        }
      }
      await rejection
      expect(instance.kill).toHaveBeenCalledWith('SIGKILL')
      expect(chunk.every((value) => value === 0)).toBe(true)
      const late = Buffer.from('late private value')
      instance.stdout.emit('data', late)
      expect(late.every((value) => value === 0)).toBe(true)
    },
  )
  it('rejects oversized headers and wrong binary key lengths before spawning', async () => {
    await expect(
      windowsVaultTransport(helper).exchange(Buffer.alloc(VAULT_LIMITS.text + 1), new Uint8Array()),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    await expect(windowsVaultTransport(helper).exchange(header, Buffer.alloc(32))).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(processStub.spawn).not.toHaveBeenCalled()
  })
  it('sanitizes synchronous spawn errors and an abort during spawning', async () => {
    processStub.spawn.mockImplementationOnce(() => {
      throw new Error('private spawn diagnostic')
    })
    await expect(windowsVaultTransport(helper).exchange(header, new Uint8Array())).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    const instance = child()
    const controller = new AbortController()
    processStub.spawn.mockImplementationOnce(() => {
      controller.abort()
      return instance
    })
    const pending = windowsVaultTransport(helper, controller.signal).exchange(
      header,
      new Uint8Array(),
    )
    instance.emit('close', 0)
    await expect(pending).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(instance.kill).toHaveBeenCalledWith('SIGKILL')
    expect(instance.stdin.readableLength).toBe(0)
  })
  it('bounds stdout and erases the oversized chunk', async () => {
    const instance = child()
    const pending = windowsVaultTransport(helper).exchange(header, new Uint8Array())
    const rejected = expect(pending).rejects.toThrow(UI_TEXT.vault.noAccess)
    const oversized = Buffer.alloc(VAULT_LIMITS.text + 32 + 4 + 1, 42)
    instance.stdout.emit('data', oversized)
    instance.emit('close', 0)
    await rejected
    expect(instance.kill).toHaveBeenCalledOnce()
    expect(oversized.every((value) => value === 0)).toBe(true)
  })
  it('does not expire a screen-lock subscription at the approval deadline', async () => {
    vi.useFakeTimers()
    const instance = child()
    const controller = new AbortController()
    const pending = windowsVaultTransport(helper, controller.signal).exchange(
      Buffer.from('{"v":1,"operation":"screenLock"}'),
      new Uint8Array(),
    )
    const rejected = expect(pending).rejects.toThrow(UI_TEXT.vault.noAccess)
    await vi.advanceTimersByTimeAsync(VAULT_APPROVAL_TTL_MS + 1)
    expect(instance.kill).not.toHaveBeenCalled()
    controller.abort()
    await rejected
  })
  it('removes abort listeners and clears timers once the helper closes', async () => {
    vi.useFakeTimers()
    const instance = child()
    const controller = new AbortController()
    const pending = windowsVaultTransport(helper, controller.signal).exchange(
      header,
      new Uint8Array(),
    )
    instance.emit('close', 0)
    await pending
    controller.abort()
    await vi.advanceTimersByTimeAsync(VAULT_APPROVAL_TTL_MS)
    expect(instance.kill).not.toHaveBeenCalled()
  })
})

async function storage() {
  const folder = await mkdtemp(path.join(tmpdir(), 'muse-vault-build-'))
  folders.push(folder)
  return folder
}
describe('Windows vault helper compiler', () => {
  it('compiles once per source digest with no credential environment and cleans scratch', async () => {
    const storageDir = await storage()
    const calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
    const run: RunProgram = async (file, args, env) => {
      calls.push({ file, args, env })
      const output = args.find((value) => value.startsWith('/out:'))?.slice('/out:'.length)
      if (output === undefined) throw new Error('missing compiler output')
      await writeFile(output, 'test executable')
      return ''
    }
    const deps = {
      storageDir,
      systemRoot: path.resolve('Windows'),
      readSource: () => Promise.resolve('test source one'),
      run,
    }
    const first = await windowsVaultExecutable(deps)
    expect(await windowsVaultExecutable(deps)).toBe(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.env).toEqual({})
    expect(calls[0]?.file.replaceAll('\\', '/')).toMatch(
      /Windows\/Microsoft.NET\/Framework\/v4.0.30319\/csc.exe$/u,
    )
    expect(calls[0]?.args).toContain(
      '/reference:' +
        path.win32.join(deps.systemRoot, 'Microsoft.NET/Framework/v4.0.30319/System.Security.dll'),
    )
    expect(await readdir(path.dirname(first))).toEqual([path.basename(first)])
    const second = await windowsVaultExecutable({
      ...deps,
      readSource: () => Promise.resolve('test source two'),
    })
    expect(second).not.toBe(first)
    expect(calls).toHaveLength(2)
  })
  it('sanitizes compiler/read errors and rejects non-absolute roots', async () => {
    const storageDir = await storage()
    const deps = {
      storageDir,
      systemRoot: path.resolve('Windows'),
      readSource: () => Promise.resolve('invalid test source'),
      run: () => Promise.reject(new Error('private compiler diagnostic')),
    }
    await expect(windowsVaultExecutable(deps)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(await readdir(path.join(storageDir, 'vault-helper'))).toEqual([])
    await expect(windowsVaultExecutable({ ...deps, storageDir: 'relative' })).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    await expect(windowsVaultExecutable({ ...deps, systemRoot: 'relative' })).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    await expect(
      windowsVaultExecutable({
        ...deps,
        readSource: () => Promise.reject(new Error('private source diagnostic')),
      }),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('runs the real compiler port with a private environment and fixed diagnostics', async () => {
    const storageDir = await storage()
    processStub.execFile.mockImplementation(
      (_file, _args, options, callback: (error: Error | null) => void) => {
        expect(options).toMatchObject({ env: {}, windowsHide: true })
        callback(new Error('compiler canary'))
      },
    )
    await expect(
      windowsVaultExecutable({
        storageDir,
        systemRoot: path.resolve('Windows'),
        readSource: () => Promise.resolve('test source'),
      }),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(processStub.execFile).toHaveBeenCalledOnce()
  })
})
