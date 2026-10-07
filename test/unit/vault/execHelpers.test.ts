import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createServer, connect } from 'node:net'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VaultExecHelperServer,
  callVaultExecHelper,
  type VaultExecHelperDeps,
} from '../../../src/core/vault/exec/helpers'
import { vaultExecHelperEntry } from '../../../src/core/vault/exec/entry'
import { prepareVaultExecHelperPaths } from '../../../src/host/vault/vaultExecSpawn'
import { vaultPrivateDirectory } from '../../../src/core/vault/broker/files'
import { UI_TEXT, VAULT_LIMITS } from '../../../src/shared/constants'

const folders: string[] = []
const servers: VaultExecHelperServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function helper(deps: Partial<VaultExecHelperDeps> = {}) {
  const root = await mkdtemp(path.join(process.cwd(), 'temp/m109-x-helper-'))
  folders.push(root)
  const endpoint =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\m109-x-${randomBytes(16).toString('hex')}`
      : path.join(root, 'socket')
  const value = Buffer.from(randomBytes(32).toString('base64url'))
  const askpass = vi.fn(() => {
    const copy = Buffer.alloc(value.length)
    copy.set(value)
    return copy
  })
  const git = vi.fn(() => Buffer.alloc(0))
  const authenticate = vi.fn(() => Promise.resolve(true))
  const server = new VaultExecHelperServer({
    askpass,
    git,
    authenticate,
    // Windows peers/DACL are fake ports; native pipe framing still runs.
    ...(process.platform === 'win32' && {
      listener: {
        listen: async (endpoint, accepted) => {
          const native = createServer({ allowHalfOpen: true }, accepted)
          await new Promise<void>((resolve, reject) => {
            native.once('error', reject)
            native.listen(endpoint, resolve)
          })
          return async () => {
            await new Promise<void>((resolve) =>
              native.close(() => {
                resolve()
              }),
            )
          }
        },
      },
    }),
    ...deps,
  })
  servers.push(server)
  await server.listen(endpoint)
  return { server, root, endpoint, value, askpass, git, authenticate }
}
const trustedServer = () => Promise.resolve(true)
describe('M109 X private helpers', () => {
  it('authenticates the command-tree peer before returning private bytes and ignores git store', async () => {
    const fixture = await helper()
    const bytes = await callVaultExecHelper(fixture.endpoint, { kind: 'askpass' }, trustedServer)
    try {
      expect(bytes).toEqual(fixture.value)
    } finally {
      bytes.fill(0)
    }
    expect(fixture.authenticate).toHaveBeenCalledOnce()
    const ignored = await callVaultExecHelper(
      fixture.endpoint,
      { kind: 'git', operation: 'store', input: 'protocol=https\nhost=example.test\n\n' },
      trustedServer,
    )
    expect(ignored.length).toBe(0)
    expect(fixture.git).toHaveBeenCalledWith('store', expect.any(String))
  })
  it('denies a foreign tree, an unverified server and forged helper arguments before reading a value', async () => {
    const fixture = await helper({ authenticate: () => Promise.resolve(false) })
    await expect(
      callVaultExecHelper(fixture.endpoint, { kind: 'askpass' }, trustedServer),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(fixture.askpass).not.toHaveBeenCalled()
    const verified = await helper()
    await expect(
      callVaultExecHelper(verified.endpoint, { kind: 'askpass' }, () => Promise.resolve(false)),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    await expect(
      callVaultExecHelper(fixture.endpoint, { kind: 'askpass', operation: 'get' }, trustedServer),
    ).rejects.toThrow()
    expect(fixture.askpass).not.toHaveBeenCalled()
  })
  it('invalidates a queued authentication effect on close, with no late value release', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<boolean>()
    const fixture = await helper({
      authenticate: () => {
        entered.resolve(undefined)
        return release.promise
      },
    })
    const result = callVaultExecHelper(fixture.endpoint, { kind: 'askpass' }, trustedServer)
    const rejected = expect(result).rejects.toThrow(UI_TEXT.vault.noAccess)
    await entered.promise
    await fixture.server.close()
    release.resolve(true)
    await rejected
    expect(fixture.askpass).not.toHaveBeenCalled()
  })
  it('closes a native listener acquired after its owner closes', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<() => Promise<void>>()
    const close = vi.fn(() => Promise.resolve())
    const server = new VaultExecHelperServer({
      authenticate: trustedServer,
      listener: {
        listen: () => {
          entered.resolve(undefined)
          return release.promise
        },
      },
    })
    servers.push(server)
    const started = server.listen('test-only-endpoint')
    await entered.promise
    await server.close()
    release.resolve(close)
    await expect(started).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(close).toHaveBeenCalledOnce()
  })
  it('serializes private helper callbacks and rejects a second listen owner', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<boolean>()
    let attempts = 0
    const fixture = await helper({
      authenticate: () => {
        if (++attempts === 1) {
          entered.resolve(undefined)
          return release.promise
        }
        return Promise.resolve(true)
      },
    })
    const first = callVaultExecHelper(fixture.endpoint, { kind: 'askpass' }, trustedServer)
    await entered.promise
    const second = callVaultExecHelper(fixture.endpoint, { kind: 'askpass' }, trustedServer)
    expect(fixture.askpass).not.toHaveBeenCalled()
    release.resolve(true)
    const answers = await Promise.all([first, second])
    for (const bytes of answers) bytes.fill(0)
    expect(fixture.askpass).toHaveBeenCalledTimes(2)
    await expect(fixture.server.listen(fixture.endpoint)).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('writes a value only to the helper private stdout and wipes the write buffer after consumption', async () => {
    const fixture = await helper()
    const writes: Buffer[] = []
    const output = new Writable({
      write(chunk: Buffer, _encoding, done) {
        expect(chunk).toEqual(fixture.value)
        writes.push(chunk)
        done()
      },
    })
    await vaultExecHelperEntry(
      'askpass',
      fixture.endpoint,
      undefined,
      Readable.from([]),
      output,
      trustedServer,
    )
    expect(writes[0]!.every((byte) => byte === 0)).toBe(true)
    const gitOutput = new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    })
    await vaultExecHelperEntry(
      'git',
      fixture.endpoint,
      'store',
      Readable.from([Buffer.from('protocol=https\n\n')]),
      gitOutput,
      trustedServer,
    )
  })
  it('rejects malformed helper frames before reading a value and rejects unauthenticated replies', async () => {
    const fixture = await helper()
    for (const frame of [
      JSON.stringify({ kind: 'askpass', value: 'forged' }) + '\n',
      ' '.repeat(VAULT_LIMITS.frameBytes) + JSON.stringify({ kind: 'askpass' }) + '\n',
    ]) {
      const socket = connect(fixture.endpoint)
      const closed = new Promise<void>((resolve) => {
        socket.once('close', () => {
          resolve()
        })
        socket.on('error', () => undefined)
      })
      socket.on('data', (bytes: Buffer) => bytes.fill(0))
      socket.end(frame)
      await closed
    }
    expect(fixture.askpass).not.toHaveBeenCalled()
    await fixture.server.close()
    const native = createServer((socket) => {
      socket.once('data', () => socket.end(Buffer.from([2, 65])))
    })
    await new Promise<void>((resolve, reject) => {
      native.once('error', reject)
      native.listen(fixture.endpoint, resolve)
    })
    try {
      await expect(
        callVaultExecHelper(fixture.endpoint, { kind: 'askpass' }, trustedServer),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
    } finally {
      await new Promise<void>((resolve) =>
        native.close(() => {
          resolve()
        }),
      )
    }
  })
  it('refuses Windows wrapper files without a native owner-only directory port', async () => {
    const fixture = await helper()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    try {
      await expect(
        prepareVaultExecHelperPaths(fixture.root, '/node', '/entry', fixture.endpoint, 'win32'),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('writes only endpoint/executable paths into owner-only helper wrappers and removes them', async () => {
    const fixture = await helper()
    // DACL verification is a fake port on Windows; Unix modes are checked natively.
    const protect = vi.fn(async (folder: string) => {
      if (process.platform === 'win32') await mkdir(folder, { recursive: true })
      else await vaultPrivateDirectory(folder)
    })
    const wrappers = await prepareVaultExecHelperPaths(
      fixture.root,
      '/node path/node',
      '/entry path/vaultExec.js',
      fixture.endpoint,
      'linux',
      protect,
    )
    expect(protect).toHaveBeenNthCalledWith(1, fixture.root)
    expect(protect).toHaveBeenNthCalledWith(2, path.dirname(wrappers.askpassPath))
    const script = await readFile(wrappers.askpassPath, 'utf8')
    expect(script).toContain("'/node path/node' '/entry path/vaultExec.js' helper askpass")
    expect(script).not.toContain(fixture.value.toString())
    expect(wrappers.gitHelper).toContain('helper git')
    expect(await readFile(wrappers.refusingHelper, 'utf8')).toContain('exit 1')
    await wrappers.close()
    await expect(readFile(wrappers.askpassPath)).rejects.toThrow()
  })
})
