import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
  symlink,
  chmod,
  link,
  unlink,
  lstat,
} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  readVaultPolicy,
  vaultPolicyCeiling,
  vaultPolicyFile,
  writeVaultPolicy,
} from '../../../src/runtime/vault/vaultPolicy'
import { vaultRequesterSchema } from '../../../src/shared/vault'
import { VAULT_LIMITS } from '../../../src/shared/constants'

// D243 lane T: the person vault policy file — the ceiling owner. Real
// files under a generated folder; the requester is the real schema's.

const state = { root: '' }
const requester = (workspaceId: string, isHeadless: boolean) =>
  vaultRequesterSchema.parse({
    id: 'a'.repeat(32),
    hostId: 'b'.repeat(32),
    conversationId: 'c'.repeat(32),
    taskId: null,
    role: { kind: isHeadless ? 'headless' : 'orchestrator' },
    workspaceId,
    deviceId: null,
    peerProcessId: process.pid,
    sessionId: null,
    unattended: isHeadless,
    source: isHeadless ? 'headless' : 'conversation',
  })

// POSIX only: Windows file modes do not carry the owner-only bits these
// cases assert, and the policy writer there keeps the pipe directory's DACL.
const askPolicy = () => ({
  ceilings: [
    {
      workspaceId: state.root,
      role: { kind: 'headless' as const },
      ceiling: 'ask' as const,
    },
  ],
})

beforeAll(async () => {
  state.root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vp-')))
})
afterAll(async () => {
  if (state.root) await rm(state.root, { recursive: true, force: true })
})

describe('person vault policy (D243)', () => {
  it('defaults to no ceiling and round-trips the person file', async () => {
    expect(await readVaultPolicy(state.root)).toBeUndefined()
    expect(await vaultPolicyCeiling(state.root, requester(state.root, true))).toBe('none')
    await writeVaultPolicy(state.root, {
      ceilings: [
        {
          workspaceId: state.root,
          role: { kind: 'headless' },
          ceiling: ['secret://service-key'],
        },
        { workspaceId: state.root, role: { kind: 'orchestrator' }, ceiling: 'ask' },
      ],
    })
    if (process.platform !== 'win32') {
      const info = await stat(vaultPolicyFile(state.root))
      expect(info.mode & 0o077).toBe(0)
    }
    expect(await vaultPolicyCeiling(state.root, requester(state.root, true))).toEqual([
      'secret://service-key',
    ])
    expect(await vaultPolicyCeiling(state.root, requester(state.root, false))).toBe('ask')
    expect(await vaultPolicyCeiling(state.root, requester('/elsewhere', true))).toBe('none')
  })

  it('a damaged policy refuses every use instead of guessing', async () => {
    await writeFile(vaultPolicyFile(state.root), '{"ceilings":[{"workspaceId":1}]}')
    expect(await vaultPolicyCeiling(state.root, requester(state.root, true))).toBe('none')
    const text = await readFile(vaultPolicyFile(state.root), 'utf8')
    expect(text).toContain('ceilings')
  })

  it('a symlink in place of the policy is refused instead of widening the ceiling', async () => {
    if (process.platform === 'win32') return
    const wider = path.join(state.root, 'wider.json')
    await writeFile(wider, `${JSON.stringify(askPolicy())}\n`, { mode: 0o600 })
    const target = vaultPolicyFile(state.root)
    await rm(target, { force: true })
    await symlink(wider, target)
    expect(await vaultPolicyCeiling(state.root, requester(state.root, true))).toBe('none')
    expect(await readFile(wider, 'utf8')).toContain('"ask"')
  })

  it('a planted next-name symlink cannot clobber another file when the policy is saved', async () => {
    if (process.platform === 'win32') return
    const canary = path.join(state.root, 'canary')
    const marker = 'canary-bytes-stay\n'
    await writeFile(canary, marker, { mode: 0o600 })
    const next = `${vaultPolicyFile(state.root)}.next`
    await rm(next, { force: true })
    await symlink(canary, next)
    await writeVaultPolicy(state.root, { ceilings: [] })
    expect(await readFile(canary, 'utf8')).toBe(marker)
    const info = await lstat(vaultPolicyFile(state.root))
    expect(info.isSymbolicLink()).toBe(false)
    expect(info.isFile()).toBe(true)
  })

  it('a policy other accounts can read is refused', async () => {
    if (process.platform === 'win32') return
    await writeVaultPolicy(state.root, askPolicy())
    await chmod(vaultPolicyFile(state.root), 0o644)
    expect(await vaultPolicyCeiling(state.root, requester(state.root, true))).toBe('none')
  })

  it('a policy with a second name is refused', async () => {
    if (process.platform === 'win32') return
    await writeVaultPolicy(state.root, askPolicy())
    const extra = path.join(state.root, 'policy-alias')
    await rm(extra, { force: true })
    await link(vaultPolicyFile(state.root), extra)
    expect(await vaultPolicyCeiling(state.root, requester(state.root, true))).toBe('none')
    await unlink(extra)
  })

  it('a policy larger than the frame is refused without being treated as a ceiling', async () => {
    if (process.platform === 'win32') return
    const target = vaultPolicyFile(state.root)
    await rm(target, { force: true })
    await writeFile(target, Buffer.alloc(VAULT_LIMITS.frameBytes + 1), { mode: 0o600 })
    expect(await vaultPolicyCeiling(state.root, requester(state.root, true))).toBe('none')
  })
})
