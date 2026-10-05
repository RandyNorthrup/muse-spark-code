import { constants } from 'node:fs'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import * as programs from '../../src/host/processTree'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJudgeTokenFile, type JudgeWindowsAcl } from '../../src/runtime/judge/tokenFile'
import receipt from '../fixtures/judge/acl/windows-owner-only.json'

vi.mock('../../src/host/processTree', async (importOriginal) => ({
  ...(await importOriginal<typeof programs>()),
}))
vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

const folders: string[] = []
const tokens: Awaited<ReturnType<typeof createJudgeTokenFile>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const token of tokens.splice(0)) await token.remove()
  for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true })
})
async function folder() {
  const value = await fs.mkdtemp(path.join(process.cwd(), '.judge-token-test-'))
  folders.push(value)
  return value
}
describe('judge serve token file', () => {
  it('uses an exclusive private file and verifies permissions before its single write', async () => {
    const seen: boolean[] = []
    const secure = vi.fn<JudgeWindowsAcl['secure']>(async (file, isDirectory) => {
      seen.push(isDirectory)
      if (!isDirectory) {
        const own = await fs.stat(file)
        expect(own.size).toBe(0)
      }
      return receipt
    })
    const token = await createJudgeTokenFile(await folder(), { secure })
    tokens.push(token)
    expect(seen).toEqual([true, false])
    expect(token.aclReceipt).toEqual({ platform: 'win32', ownerOnly: true, windows: receipt })
    expect((await fs.readFile(token.path, 'utf8')) === token.token).toBe(true)
    expect(token.token.length).toBe(64)
    expect(path.basename(path.dirname(token.path))).toMatch(/^muse-judge-/)
  })
  it('records real POSIX 0700 directory and 0600 file ownership', async () => {
    const token = await createJudgeTokenFile(await folder())
    tokens.push(token)
    if (process.platform === 'win32') {
      expect(token.aclReceipt.windows?.protected).toBe(true)
      return
    }
    expect(token.aclReceipt).toEqual({ platform: process.platform, ownerOnly: true, mode: 0o600 })
    const file = await fs.stat(token.path)
    const directory = await fs.stat(path.dirname(token.path))
    expect(file.mode & 0o777).toBe(0o600)
    expect(directory.mode & 0o777).toBe(0o700)
    expect(file.uid).toBe(process.getuid === undefined ? undefined : process.getuid())
    expect(directory.uid).toBe(process.getuid === undefined ? undefined : process.getuid())
    expect(file.nlink).toBe(1)
  })
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
    await expect(
      createJudgeTokenFile(parent, { secure: () => Promise.resolve(value) }),
    ).rejects.toThrow('EJUDGE_TOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses a file ACL failure after a valid directory receipt without writing the token', async () => {
    const parent = await folder()
    let size = -1
    const secure: JudgeWindowsAcl['secure'] = async (file, isDirectory) => {
      if (isDirectory) return receipt
      const own = await fs.stat(file)
      size = own.size
      return { ...receipt, protected: false }
    }
    await expect(createJudgeTokenFile(parent, { secure })).rejects.toThrow('EJUDGE_TOKEN_ACL')
    expect(size).toBe(0)
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses unavailable ACL inspection', async () => {
    const parent = await folder()
    await expect(
      createJudgeTokenFile(parent, {
        secure: () => Promise.reject(new Error('synthetic OS inspection failure')),
      }),
    ).rejects.toThrow('EJUDGE_TOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses POSIX permissions that remain broad after chmod', async () => {
    if (process.platform === 'win32') {
      await expect(
        createJudgeTokenFile(await folder(), {
          secure: () => Promise.resolve({ ...receipt, protected: false }),
        }),
      ).rejects.toThrow('EJUDGE_TOKEN_ACL')
      return
    }
    const parent = await folder()
    const chmod = fs.chmod
    vi.spyOn(fs, 'chmod').mockImplementation(async (file, mode) => {
      await chmod(file, mode)
      await chmod(file, 0o777)
    })
    await expect(createJudgeTokenFile(parent)).rejects.toThrow('EJUDGE_TOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses POSIX foreign ownership', async () => {
    if (process.getuid === undefined) {
      await expect(
        createJudgeTokenFile(await folder(), {
          secure: () => Promise.resolve({ ...receipt, ownerSid: 'foreign' }),
        }),
      ).rejects.toThrow('EJUDGE_TOKEN_ACL')
      return
    }
    const parent = await folder()
    vi.spyOn(process, 'getuid').mockReturnValue(process.getuid() + 1)
    await expect(createJudgeTokenFile(parent)).rejects.toThrow('EJUDGE_TOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('uses the bounded Windows launcher with encoded paths and no bearer in arguments or environment', async () => {
    const run = vi.spyOn(programs, 'runProgram').mockResolvedValue(JSON.stringify(receipt))
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const token = await createJudgeTokenFile(await folder())
    tokens.push(token)
    expect(run).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(run.mock.calls).includes(token.token)).toBe(false)
    for (const [executable, args, env] of run.mock.calls) {
      expect(executable).toMatch(/powershell\.exe$/)
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
      vi.stubGlobal('process', { ...process, platform: 'win32' })
      const parent = await folder()
      await expect(createJudgeTokenFile(parent)).rejects.toThrow('EJUDGE_TOKEN_ACL')
      expect(await fs.readdir(parent)).toEqual([])
    },
  )
  it('removes the private directory through synchronous exit cleanup', async () => {
    const parent = await folder()
    const token = await createJudgeTokenFile(parent)
    token.removeSync()
    expect(await fs.readdir(parent)).toEqual([])
  })
  it('refuses a symlink token path before its write', async () => {
    const parent = await folder()
    const outside = path.join(parent, 'sentinel')
    await fs.writeFile(outside, '')
    const create = fs.open
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await create(file, flags, mode)
      await fs.unlink(file)
      await fs.symlink(outside, file)
      return handle
    })
    await expect(
      createJudgeTokenFile(parent, { secure: () => Promise.resolve(receipt) }),
    ).rejects.toThrow('EJUDGE_TOKEN_ACL')
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
    await expect(createJudgeTokenFile(parent)).rejects.toThrow('EJUDGE_TOKEN_ACL')
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
    await expect(createJudgeTokenFile(parent)).rejects.toThrow('EJUDGE_TOKEN_ACL')
    expect(await fs.readdir(parent)).toEqual([])
  })
})
