import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUserPresence } from '../../src/runtime/maker/userPresence'
import {
  MAKER_PRESENCE_ACTION,
  MAKER_PRESENCE_POLICY,
  MAKER_PRESENCE_POLICY_SHA256,
  MAKER_PRESENCE_TIMEOUT_MS,
} from '../../src/shared/constants'

const os = vi.hoisted(() => ({
  uid: 1000,
  stat: vi.fn<(file: string) => Promise<{ uid: number; mode: number }>>(),
  readFile: vi.fn<(file: string) => Promise<string>>(),
  execFile:
    vi.fn<
      (
        file: string,
        args: readonly string[],
        options: { env: object; timeout: number },
        callback: (error: { code: number } | null) => void,
      ) => void
    >(),
}))
vi.mock('node:fs/promises', () => ({ stat: os.stat, readFile: os.readFile }))
vi.mock('node:process', () => ({ default: { pid: 42, getuid: () => os.uid } }))
vi.mock('node:child_process', () => ({ execFile: os.execFile }))
const processStat = `1 (agent) ${Array.from({ length: 19 }, () => '0').join(' ')} 42`
const policy = readFileSync(path.resolve('native/linux/org.muse-spark-code.maker.policy'), 'utf8')
const request = {
  id: 'approval-id',
  digest: 'a'.repeat(64),
  machine: 'Bench printer',
  summary: 'Send once',
}
beforeEach(() => {
  os.uid = 1000
  os.stat.mockResolvedValue({ uid: 0, mode: 0o644 })
  os.readFile.mockImplementation((file) =>
    Promise.resolve(
      file === MAKER_PRESENCE_POLICY ? policy.replace('@UID@', () => String(os.uid)) : processStat,
    ),
  )
  os.execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(null)
  })
})
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
describe('Linux OS user presence', () => {
  it('shipped policy has the exact pin, auth_self and per-account action ownership, without cached grants', () => {
    expect(createHash('sha256').update(policy).digest('hex')).toBe(MAKER_PRESENCE_POLICY_SHA256)
    expect(policy).toContain('<allow_active>auth_self</allow_active>')
    expect(policy).toContain('unix-user:@UID@')
    expect(policy).not.toContain('auth_self_keep')
  })
  it('checks a fixed system binary with no inherited environment and the exact action details', async () => {
    expect(await createUserPresence('linux').check(request)).toBe('approved')
    expect(os.execFile).toHaveBeenCalledWith(
      '/usr/bin/pkcheck',
      expect.arrayContaining([
        '--action-id',
        MAKER_PRESENCE_ACTION,
        '--allow-user-interaction',
        '--process',
        '42,42,1000',
        '--detail',
        'approval-id',
        request.id,
        'payload-digest',
        request.digest,
        'Bench printer: Send once (payload aaaaaaaaaaaa)',
      ]),
      expect.objectContaining({ env: {}, timeout: MAKER_PRESENCE_TIMEOUT_MS }),
      expect.any(Function),
    )
  })
  it.each([
    [1, 'denied'],
    [3, 'denied'],
    [2, 'unavailable'],
    [127, 'unavailable'],
  ] as const)('pkcheck exit %s is %s', async (code, result) => {
    os.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback({ code })
    })
    expect(await createUserPresence('linux').check(request)).toBe(result)
  })
  it('refuses root execution before authentication even with a matching root-owned policy', async () => {
    os.uid = 0
    expect(await createUserPresence('linux').check(request)).toBe('unavailable')
    expect(os.execFile).not.toHaveBeenCalled()
  })
  it.each([
    [1000, 0o644],
    [0, 0o666],
  ])('refuses an unsafe pkcheck owner %s and mode %s', async (uid, mode) => {
    os.stat.mockImplementation((file) =>
      Promise.resolve(file === '/usr/bin/pkcheck' ? { uid, mode } : { uid: 0, mode: 0o644 }),
    )
    expect(await createUserPresence('linux').check(request)).toBe('unavailable')
    expect(os.execFile).not.toHaveBeenCalled()
  })
  it('refuses malformed kernel start metadata before invoking pkcheck', async () => {
    os.readFile.mockImplementation((file) =>
      Promise.resolve(
        file === MAKER_PRESENCE_POLICY
          ? policy.replace('@UID@', '1000')
          : processStat.replace(/42$/, 'invalid'),
      ),
    )
    expect(await createUserPresence('linux').check(request)).toBe('unavailable')
    expect(os.execFile).not.toHaveBeenCalled()
  })
  it.each(['missing', 'changed', 'writable', 'foreign', 'other-user'] as const)(
    'refuses a %s policy before starting authentication',
    async (kind) => {
      switch (kind) {
        case 'missing': {
          os.stat.mockRejectedValue(new Error('ENOENT'))
          break
        }
        case 'changed': {
          os.readFile.mockImplementation((file) =>
            Promise.resolve(
              file === MAKER_PRESENCE_POLICY
                ? policy.replace('@UID@', '1000').replace('auth_self', 'yes')
                : processStat,
            ),
          )
          break
        }
        case 'writable': {
          os.stat.mockImplementation((file) =>
            Promise.resolve({ uid: 0, mode: file === MAKER_PRESENCE_POLICY ? 0o666 : 0o644 }),
          )
          break
        }
        case 'foreign': {
          os.stat.mockImplementation((file) =>
            Promise.resolve({ uid: file === MAKER_PRESENCE_POLICY ? 1000 : 0, mode: 0o644 }),
          )
          break
        }
        case 'other-user': {
          os.readFile.mockImplementation((file) =>
            Promise.resolve(
              file === MAKER_PRESENCE_POLICY ? policy.replace('@UID@', '1001') : processStat,
            ),
          )
          break
        }
      }
      expect(await createUserPresence('linux').check(request)).toBe('unavailable')
      expect(os.execFile).not.toHaveBeenCalled()
    },
  )
})
