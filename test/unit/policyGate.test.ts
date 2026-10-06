import { describe, expect, it } from 'vitest'
import { accountPolicyQuestion } from '../../src/core/accounts/policyGate'
import { ACCOUNT_POLICIES } from '../../src/core/providers/accountPolicy'
import { UI_TEXT } from '../../src/shared/constants'
import { policyRig } from './helpers/accounts/policy'

const vendor = { kind: 'vendorLimit', reason: 'rateLimited', resetAt: null } as const
const cap = {
  kind: 'userCap',
  metric: 'requests',
  period: 'day',
  value: 1,
  threshold: 1,
  resetAt: '2026-10-07T00:00:00Z',
} as const

describe('M108 vendor account policy gate', () => {
  it.each(ACCOUNT_POLICIES)(
    '$provider/$product enforces its policy for vendor limits and user caps',
    async (row) => {
      const t = policyRig(row.provider, row.product)
      const request = { policy: t.policy, isInteractive: true, hasOfferedRecovery: true }
      const isDenied = row.pooling === 'notOffered' || !row.isCredentialHeld
      const decision1 = await t.gate.authorize({ ...request, trigger: cap })
      expect(decision1.kind).toBe(isDenied ? 'stop' : 'allow')
      expect(t.ask).toHaveBeenCalledTimes(
        !isDenied && row.multipleAccounts === 'onePerPerson' ? 1 : 0,
      )
      const decision2 = await t.gate.authorize({ ...request, trigger: vendor })
      expect(decision2.kind).toBe(isDenied ? 'stop' : 'allow')
      expect(t.ask).toHaveBeenCalledTimes(
        !isDenied && (row.pooling === 'confirm' || row.multipleAccounts === 'onePerPerson') ? 1 : 0,
      )
    },
  )

  it('blocks vendor pooling after Only at my own caps and Cancel; keeps ordinary user caps', async () => {
    for (const choice of ['ownCapsOnly', 'cancel']) {
      const t = policyRig()
      t.ask.mockResolvedValue(choice)
      expect(
        await t.gate.authorize({ policy: t.policy, trigger: vendor, isInteractive: true }),
      ).toEqual({ kind: 'stop', reason: choice })
      const own = await t.gate.authorize({ policy: t.policy, trigger: cap, isInteractive: true })
      expect(own.kind).toBe('allow')
      expect(t.ask).toHaveBeenCalledTimes(1)
    }
    const onePerson = policyRig('openrouter', 'api')
    onePerson.ask.mockResolvedValue('ownCapsOnly')
    expect(
      await onePerson.gate.authorize({
        policy: onePerson.policy,
        trigger: cap,
        isInteractive: true,
      }),
    ).toEqual({ kind: 'stop', reason: 'ownCapsOnly' })
  })

  it('offers each documented subscription recovery before the confirmation', async () => {
    for (const [provider, product, recovery] of [
      ['openai', 'chatgpt-plan', 'chatgptPlan'],
      ['meta', 'muse-code', 'museCodeSubscription'],
    ]) {
      const t = policyRig(provider, product)
      const request = { policy: t.policy, trigger: vendor, isInteractive: true }
      expect(await t.gate.authorize(request)).toEqual({ kind: 'recovery', recovery })
      expect(t.ask).not.toHaveBeenCalled()
      const decision3 = await t.gate.authorize({ ...request, hasOfferedRecovery: true })
      expect(decision3.kind).toBe('allow')
      expect(t.ask).toHaveBeenCalledTimes(1)
    }
  })

  it('headless requires a local confirmation and never opens a dialog', async () => {
    const t = policyRig()
    const request = { policy: t.policy, trigger: vendor, isInteractive: false }
    expect(await t.gate.authorize(request)).toEqual({ kind: 'stop', reason: 'confirmation' })
    expect(t.ask).not.toHaveBeenCalled()
    await t.confirmations.obtain(t.policy(), true)
    const decision4 = await t.gate.authorize(request)
    expect(decision4.kind).toBe('allow')
  })

  it('revocation and a changed row invalidate a held admission immediately', async () => {
    const t = policyRig()
    const decision = await t.gate.authorize({
      policy: t.policy,
      trigger: vendor,
      isInteractive: true,
    })
    expect(decision.kind).toBe('allow')
    if (decision.kind !== 'allow') throw new Error('expected allow')
    expect(decision.isCurrent(t.policy())).toBe(true)
    await t.confirmations.revoke('meta', 'model-api')
    expect(decision.isCurrent(t.policy())).toBe(false)
    const own = await t.gate.authorize({ policy: t.policy, trigger: cap, isInteractive: true })
    t.change({ pooling: 'notOffered' })
    expect(own.kind === 'allow' && own.isCurrent(t.policy())).toBe(false)
  })

  it('refuses unknown rows and changed rows while a question is open', async () => {
    const t = policyRig()
    expect(
      await t.gate.authorize({ policy: () => undefined, trigger: cap, isInteractive: true }),
    ).toEqual({ kind: 'stop', reason: 'notOffered' })
    t.ask.mockImplementation(() => {
      t.change({ recordVersion: 'changed' })
      return Promise.resolve('confirm')
    })
    expect(
      await t.gate.authorize({ policy: t.policy, trigger: vendor, isInteractive: true }),
    ).toEqual({ kind: 'stop', reason: 'confirmation' })
  })

  it('quotes the recorded sources and dates with the translated warning and three answers', () => {
    const t = policyRig()
    const question = accountPolicyQuestion(t.policy())
    expect(question.sources).toEqual(t.policy().sources)
    expect(question.checkedAt).toBe('2026-10-05')
    expect(question.warning).toContain('restrict or prohibit')
    expect(question.warning).toContain('may act against your accounts')
    expect(question.legitimate).toBe(UI_TEXT.accounts.legitimate)
    expect(question.choices.map((choice) => choice.id)).toEqual([
      'confirm',
      'ownCapsOnly',
      'cancel',
    ])
  })
})
