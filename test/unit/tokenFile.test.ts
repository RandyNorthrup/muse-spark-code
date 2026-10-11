import { constants } from 'node:fs'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import * as programs from '../../src/host/processTree'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTokenFile, type TokenWindowsAcl } from '../../src/runtime/tokenFile'
const receipt = {
  ownerSid: 'S-1-5-21-100-200-300-1001',
  currentSid: 'S-1-5-21-100-200-300-1001',
  protected: true,
  rules: [{ sid: 'S-1-5-21-100-200-300-1001', inherited: false, allow: true, fullControl: true }],
}
import { withoutCredentials, withoutKeyringRoutes } from '../../src/runtime/credentialVariables'

vi.mock('../../src/host/processTree', async (importOriginal) => ({
  ...(await importOriginal<typeof programs>()),
}))
vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

const folders: string[] = []
const tokens: Awaited<ReturnType<typeof createTokenFile>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const token of tokens.splice(0)) await token.remove()
  for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true })
})
async function folder() {
  const value = await fs.mkdtemp(path.join(process.cwd(), '.token-test-'))
  folders.push(value)
  return value
}
async function createTrackedToken(parent: string) {
  const token = await createTokenFile(parent)
  tokens.push(token)
}
describe('shared token file', () => {
  it('uses an exclusive private file and verifies permissions before its single write', async () => {
    const create = vi.spyOn(fs, 'open')
    const seen: boolean[] = []
    const secure = vi.fn<TokenWindowsAcl['secure']>(async (file, isDirectory) => {
      seen.push(isDirectory)
      if (!isDirectory) {
        const own = await fs.stat(file)
        expect(own.size).toBe(0)
      }
      return receipt
    })
    const token = await createTokenFile(await folder(), { secure })
    tokens.push(token)
    expect(seen).toEqual([true, false])
    // Node's wx is O_WRONLY | O_CREAT | O_EXCL; mode is set on creation.
    expect(create).toHaveBeenCalledWith(token.path, 'wx', constants.S_IRUSR | constants.S_IWUSR)
    expect(token.aclReceipt).toEqual({ platform: 'win32', ownerOnly: true, windows: receipt })
    expect((await fs.readFile(token.path, 'utf8')) === token.token).toBe(true)
    expect(token.token.length).toBe(64)
    expect(path.basename(path.dirname(token.path))).toMatch(/^muse-token-/)
  })
  it('records real POSIX 0700 directory and 0600 file ownership', async () => {
    const token = await createTokenFile(await folder())
    tokens.push(token)
    if (process.platform === 'win32') {
      expect(token.aclReceipt.windows?.protected).toBe(true)
      return
    }
    expect(token.aclReceipt).toEqual({
      platform: process.platform,
      ownerOnly: true,
      mode: 0o600,
      ...(process.platform === 'darwin' && { extendedAcl: false }),
    })
    const file = await fs.stat(token.path)
    const directory = await fs.stat(path.dirname(token.path))
    expect(file.mode & 0o777).toBe(0o600)
    expect(directory.mode & 0o777).toBe(0o700)
    expect(file.uid).toBe(process.getuid === undefined ? undefined : process.getuid())
    expect(directory.uid).toBe(process.getuid === undefined ? undefined : process.getuid())
    expect(file.nlink).toBe(1)
  })
  // These are installed macOS ACL receipts; other hosts retain their own
  // POSIX/Windows tests and cannot count them as platform evidence.
  if (process.platform === 'darwin') {
    it('refuses real inherited macOS ACL grants that survive 0700 chmod', async () => {
      const parent = await folder()
      await programs.runProgram(
        '/bin/chmod',
        [
          '+a',
          'everyone allow read,readattr,readextattr,readsecurity,execute,file_inherit,directory_inherit',
          parent,
        ],
        withoutKeyringRoutes(withoutCredentials(process.env)),
      )
      const create = vi.spyOn(fs, 'open')
      const starting = createTrackedToken(parent)
      await expect(starting).rejects.toThrow('ETOKEN_ACL')
      expect(create).not.toHaveBeenCalled()
      expect(await fs.readdir(parent)).toEqual([])
    })
    it('refuses real macOS file ACL grants before writing a bearer', async () => {
      const parent = await folder()
      const chmod = fs.chmod
      let size = -1
      vi.spyOn(fs, 'chmod').mockImplementation(async (file, mode) => {
        await chmod(file, mode)
        const own = await fs.stat(file)
        if (!own.isFile()) return
        await programs.runProgram(
          '/bin/chmod',
          ['+a', 'everyone allow read,readattr,readextattr,readsecurity', String(file)],
          withoutKeyringRoutes(withoutCredentials(process.env)),
        )
        const granted = await fs.stat(file)
        size = granted.size
      })
      const starting = createTrackedToken(parent)
      await expect(starting).rejects.toThrow('ETOKEN_ACL')
      expect(size).toBe(0)
      expect(await fs.readdir(parent)).toEqual([])
    })
    it.each(['file', 'directory'] as const)(
      'refuses a real macOS %s ACL grant added during the bearer write',
      async (target) => {
        const parent = await folder()
        const create = fs.open
        vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
          const handle = await create(file, flags, mode)
          const sync = handle.sync.bind(handle)
          vi.spyOn(handle, 'sync').mockImplementation(async () => {
            const grantPath = target === 'file' ? String(file) : path.dirname(String(file))
            await programs.runProgram(
              '/bin/chmod',
              ['+a', 'everyone allow read,readattr,readextattr,readsecurity', grantPath],
              withoutKeyringRoutes(withoutCredentials(process.env)),
            )
            await sync()
          })
          return handle
        })
        const starting = createTrackedToken(parent)
        await expect(starting).rejects.toThrow('ETOKEN_ACL')
        expect(await fs.readdir(parent)).toEqual([])
      },
    )
    it('refuses failed macOS ACL inspection without exposing OS output', async () => {
      const parent = await folder()
      vi.spyOn(programs, 'runProgram').mockRejectedValue(new Error('synthetic private OS output'))
      const starting = createTrackedToken(parent)
      await expect(starting).rejects.toThrow('ETOKEN_ACL')
      expect(await fs.readdir(parent)).toEqual([])
    })
    it.each([
      ['empty', ''],
      ['malformed', 'not an OS mode receipt\n'],
      ['ACL marker', 'drwx------+ 2 502 20 64 Oct 5 10:12 synthetic\n'],
      ['ACL entry', 'drwx------ 2 502 20 64 Oct 5 10:12 synthetic\n 0: everyone allow search\n'],
      ['wrong mode', 'drwxr----- 2 502 20 64 Oct 5 10:12 synthetic\n'],
    ])('refuses %s macOS ACL inspection output', async (_label, output) => {
      const parent = await folder()
      vi.spyOn(programs, 'runProgram').mockImplementation(async (_executable, args) => {
        const own = await fs.stat(args[1] ?? '')
        return own.isFile() ? output.replace('drwx------', '-rw-------') : output
      })
      const starting = createTrackedToken(parent)
      await expect(starting).rejects.toThrow('ETOKEN_ACL')
      expect(await fs.readdir(parent)).toEqual([])
    })
  }
  it.each([
    ['unprotected DACL', { ...receipt, protected: false }],
    ['foreign owner', { ...receipt, ownerSid: 'S-1-5-21-100-200-300-2002' }],
    [
      'broad inherited grant',
      {
        ...receipt,
        rules: [
          ...receipt.rules,
          { sid: 'S-1-1-0', inherited: true, allow: true, fullControl: true },
        ],
      },
    ],
    [
      'broad explicit grant',
      {
        ...receipt,
        rules: [
          ...receipt.rules,
          { sid: 'S-1-1-0', inherited: false, allow: true, fullControl: true },
        ],
      },
    ],
    [
      'inherited owner grant',
      { ...receipt, rules: receipt.rules.map((rule) => ({ ...rule, inherited: true })) },
    ],
    [
      'deny owner grant',
      { ...receipt, rules: receipt.rules.map((rule) => ({ ...rule, allow: false })) },
    ],
    [
      'insufficient owner grant',
      { ...receipt, rules: receipt.rules.map((rule) => ({ ...rule, fullControl: false })) },
    ],
    ['empty DACL', { ...receipt, rules: [] }],
    ['missing descriptor', {}],
    ['nonboolean descriptor', { ...receipt, protected: 'true' }],
  ])('refuses %s and removes startup artifacts', async (_label, value) => {
    const parent = await folder()
    await expect(createTokenFile(parent, { secure: () => Promise.resolve(value) })).rejects.toThrow(
      'ETOKEN_ACL',
    )
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses a file ACL failure after a valid directory receipt without writing the token', async () => {
    const parent = await folder()
    let size = -1
    const secure: TokenWindowsAcl['secure'] = async (file, isDirectory) => {
      if (isDirectory) return receipt
      const own = await fs.stat(file)
      size = own.size
      return { ...receipt, protected: false }
    }
    await expect(createTokenFile(parent, { secure })).rejects.toThrow('ETOKEN_ACL')
    expect(size).toBe(0)
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses unavailable ACL inspection', async () => {
    const parent = await folder()
    await expect(
      createTokenFile(parent, {
        secure: () => Promise.reject(new Error('synthetic OS inspection failure')),
      }),
    ).rejects.toThrow('ETOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses POSIX permissions that remain broad after chmod', async () => {
    if (process.platform === 'win32') {
      await expect(
        createTokenFile(await folder(), {
          secure: () => Promise.resolve({ ...receipt, protected: false }),
        }),
      ).rejects.toThrow('ETOKEN_ACL')
      return
    }
    const parent = await folder()
    const chmod = fs.chmod
    vi.spyOn(fs, 'chmod').mockImplementation(async (file, mode) => {
      await chmod(file, mode)
      await chmod(file, 0o777)
    })
    await expect(createTokenFile(parent)).rejects.toThrow('ETOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses POSIX foreign ownership', async () => {
    if (process.getuid === undefined) {
      await expect(
        createTokenFile(await folder(), {
          secure: () => Promise.resolve({ ...receipt, ownerSid: 'foreign' }),
        }),
      ).rejects.toThrow('ETOKEN_ACL')
      return
    }
    const parent = await folder()
    vi.spyOn(process, 'getuid').mockReturnValue(process.getuid() + 1)
    await expect(createTokenFile(parent)).rejects.toThrow('ETOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('uses the bounded Windows launcher with encoded paths and no bearer in arguments or environment', async () => {
    vi.stubEnv('M104_C_TEST_API_KEY', 'synthetic-private-value')
    vi.stubEnv('DBUS_SESSION_BUS_ADDRESS', 'synthetic-private-route')
    // SECWINPATH2: the launcher comes from Windows' own SystemRoot, on any
    // drive, never a guessed C:. POSIX runners have none, so give one.
    vi.stubEnv('SystemRoot', String.raw`D:\Windows`)
    const run = vi.spyOn(programs, 'runProgram').mockResolvedValue(JSON.stringify(receipt))
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      once: process.once.bind(process),
      off: process.off.bind(process),
    })
    const token = await createTokenFile(await folder())
    tokens.push(token)
    expect(run).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(run.mock.calls).includes(token.token)).toBe(false)
    for (const [executable, args, env] of run.mock.calls) {
      expect(executable).toMatch(/powershell\.exe$/)
      expect(executable.startsWith('D:\\Windows\\')).toBe(true)
      expect(args.slice(0, -1)).toEqual([
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
      ])
      const script = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le')
      expect(script).toContain('SetAccessRuleProtection($true, $false)')
      expect(script).toContain('Get-Acl -LiteralPath')
      expect(script).toContain('Set-Acl -LiteralPath')
      expect(Object.keys(env).some((name) => name.toUpperCase().endsWith('_API_KEY'))).toBe(false)
      expect(env['DBUS_SESSION_BUS_ADDRESS']).toBeUndefined()
    }
  })
  it.each([
    { failure: 'malformed JSON', output: () => Promise.resolve('malformed-json') },
    {
      failure: 'unprotected DACL',
      output: () => Promise.resolve(JSON.stringify({ ...receipt, protected: false })),
    },
    {
      failure: 'failed command',
      output: () => Promise.reject(new Error('synthetic private OS output')),
    },
  ])(
    'refuses actual Windows ACL helper $failure without exposing its output',
    async ({ output }) => {
      vi.spyOn(programs, 'runProgram').mockImplementation(output)
      vi.stubGlobal('process', {
        ...process,
        platform: 'win32',
        once: process.once.bind(process),
        off: process.off.bind(process),
      })
      const parent = await folder()
      await expect(createTokenFile(parent)).rejects.toThrow('ETOKEN_ACL')
      expect(await fs.readdir(parent)).toEqual([])
    },
  )
  it.each(['sync', 'close'] as const)(
    'registers synchronous exit cleanup before the written bearer waits for %s',
    async (operation) => {
      const parent = await folder()
      const existing = new Set(process.listeners('exit'))
      const create = fs.open
      let hasExitCleanup = false
      vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
        const handle = await create(file, flags, mode)
        const original = handle[operation].bind(handle)
        vi.spyOn(handle, operation).mockImplementation(async () => {
          const added = process.listeners('exit').filter((listener) => !existing.has(listener))
          hasExitCleanup = added.length === 1
          for (const listener of added) listener.call(process, 1)
          await original()
        })
        return handle
      })
      const starting = createTrackedToken(parent)
      await Promise.allSettled([starting])
      expect(hasExitCleanup).toBe(true)
      expect(await fs.readdir(parent)).toEqual([])
      expect(process.listeners('exit').filter((listener) => !existing.has(listener))).toEqual([])
    },
  )
  it('removes the private directory through synchronous exit cleanup', async () => {
    const parent = await folder()
    const token = await createTokenFile(parent)
    token.removeSync()
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('remains idempotent after synchronous cleanup and async removal', async () => {
    const parent = await folder()
    const token = await createTokenFile(parent)
    const removeDirectory = vi.spyOn(fs, 'rmdir')
    token.removeSync()
    token.removeSync()
    await token.remove()
    expect(removeDirectory).not.toHaveBeenCalled()
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('propagates directory cleanup errors other than ENOENT', async () => {
    const token = await createTokenFile(await folder())
    tokens.push(token)
    const denied = Object.assign(new Error('synthetic cleanup denial'), { code: 'EACCES' })
    const removeDirectory = vi.spyOn(fs, 'rmdir').mockRejectedValue(denied)
    await expect(token.remove()).rejects.toBe(denied)
    removeDirectory.mockRestore()
    token.removeSync()
  })
  it('refuses a symlink token path before its write', async () => {
    const parent = await folder()
    const outside = path.join(parent, 'sentinel')
    await fs.writeFile(outside, '')
    const create = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await create(file, flags, mode)
      let isPrepared = false
      try {
        await fs.unlink(file)
        await fs.symlink(outside, file)
        isPrepared = true
        return handle
      } finally {
        // Windows may refuse symlink creation; the fixture still owns this open handle.
        if (!isPrepared) await handle.close()
      }
    })
    await expect(
      createTokenFile(parent, { secure: () => Promise.resolve(receipt) }),
    ).rejects.toThrow('ETOKEN_ACL')
    const own = await fs.stat(outside)
    expect(own.size).toBe(0)
  })
  it('refuses a hard-linked token path before its write', async () => {
    const parent = await folder()
    const alias = path.join(parent, 'alias')
    const create = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await create(file, flags, mode)
      await fs.link(file, alias)
      return handle
    })
    await expect(createTokenFile(parent)).rejects.toThrow('ETOKEN_ACL')
    const own = await fs.stat(alias)
    expect(own.size).toBe(0)
  })
  it('never overwrites a preexisting token path', async () => {
    const parent = await folder()
    const create = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      await fs.writeFile(file, 'synthetic sentinel', {
        flag: 'wx',
        mode: constants.S_IRUSR | constants.S_IWUSR,
      })
      return await create(file, flags, mode)
    })
    await expect(createTokenFile(parent)).rejects.toThrow('ETOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
})
