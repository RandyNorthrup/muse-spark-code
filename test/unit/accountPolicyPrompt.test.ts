// The account policy prompt (src/host/models/accountPolicyPrompt.ts): a
// question the surface cannot show settles the asker as unanswered —
// consent is never granted by a failure — instead of leaving the
// admission waiting.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ACCOUNT_POLICIES } from '../../src/core/providers/accountPolicy'
import { AccountPolicyPrompt } from '../../src/host/models/accountPolicyPrompt'

it('settles the asker as unanswered when the surface cannot show', async () => {
  let refusal: unknown
  try {
    readFileSync(path.join(tmpdir(), `no-policy-show-${String(process.pid)}`), 'utf8')
  } catch (error: unknown) {
    refusal = error
  }
  expect(refusal).toBeInstanceOf(Error)
  const prompt = new AccountPolicyPrompt({
    show: () => {
      throw refusal
    },
    policy: () => undefined,
    now: () => Date.now(),
  })
  await expect(prompt.ask('meta', ACCOUNT_POLICIES[0])).resolves.toBe('cancel')
})

it('an overlap fails closed while the first ask stays pending', async () => {
  const prompt = new AccountPolicyPrompt({
    show: () => undefined,
    policy: () => undefined,
    now: () => Date.now(),
  })
  const first = prompt.ask('meta', ACCOUNT_POLICIES[0])
  await expect(prompt.ask('meta', ACCOUNT_POLICIES[0])).resolves.toBe('cancel')
  prompt.close()
  await expect(first).resolves.toBe('cancel')
})
