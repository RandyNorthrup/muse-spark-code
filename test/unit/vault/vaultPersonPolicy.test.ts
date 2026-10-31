import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  readVaultPolicy,
  vaultPolicyCeiling,
  vaultPolicyFile,
  writeVaultPolicy,
} from '../../../src/runtime/vault/vaultPolicy'
import { vaultRequesterSchema } from '../../../src/shared/vault'

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
})
