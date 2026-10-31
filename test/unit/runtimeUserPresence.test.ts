import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createUserPresence } from '../../src/runtime/maker/userPresence'
import { MAKER_PRESENCE_POLICY_SHA256 } from '../../src/shared/constants'

const policy = readFileSync(path.resolve('native/linux/org.muse-spark-code.maker.policy'), 'utf8')
const request = {
  id: 'approval-id',
  digest: 'a'.repeat(64),
  machine: 'Bench printer',
  summary: 'Send once',
}
describe('Linux OS user presence', () => {
  it('shipped policy has the exact pin, auth_self and per-account action ownership, without cached grants', () => {
    expect(createHash('sha256').update(policy).digest('hex')).toBe(MAKER_PRESENCE_POLICY_SHA256)
    expect(policy).toContain('<allow_active>auth_self</allow_active>')
    expect(policy).toContain('unix-user:@UID@')
    expect(policy).not.toContain('auth_self_keep')
  })
  it('is unavailable on this machine without the installed policy and pkcheck', async () => {
    // Real filesystem and process state: neither the pinned policy file nor a
    // qualifying /usr/bin/pkcheck is installed on the test rigs, so the check
    // must refuse rather than prompt. The approved and denied paths need a
    // real Linux polkit session and are covered by real use, not here.
    expect(await createUserPresence('linux').check(request)).toBe('unavailable')
  })
})
