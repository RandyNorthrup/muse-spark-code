import { describe, expect, it } from 'vitest'
import { ReportEmailDelivery } from '../../src/core/reporting/destinations/email'
import {
  REPORT_EMAIL_CODE_TTL_MS,
  REPORT_EMAIL_PER_HOUR,
  REPORT_EMAIL_PER_DAY,
  REPORT_DELIVERY_HOUR_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import { ADDRESS, CONNECTION, deliveryPayload, mailRig } from './helpers/reporting/destinations'

describe('report email verification, consent and vault transport', () => {
  it('sends a six-digit code through the opaque vault connection and keeps only its digest', async () => {
    const rig = mailRig()
    expect(await rig.verify()).toBe(true)
    const [connection, message, context] = rig.port.send.mock.calls[0]!
    expect(connection).toEqual(CONNECTION)
    expect(message.text).toMatch(/\b\d{6}\b/)
    expect(context).toMatchObject({ requireTls: true, rejectUnauthorized: true })
    expect(JSON.stringify(rig.store.state)).not.toContain(/\d{6}/.exec(message.text)![0])
    expect(await rig.email.verify(ADDRESS, /\d{6}/.exec(message.text)![0])).toBe(false)
  })
  it('refuses an unverified or off-list recipient before any report send', async () => {
    const rig = mailRig()
    const payload = deliveryPayload()
    expect(await rig.email.send('one', 'email', ADDRESS, CONNECTION, payload)).toEqual({
      status: 'failed',
    })
    expect(rig.port.send).not.toHaveBeenCalled()
    await rig.verify()
    await rig.email.confirm(ADDRESS, payload)
    rig.port.send.mockClear()
    rig.port.isRecipientAllowed.mockResolvedValue(false)
    expect(await rig.email.send('one', 'email', ADDRESS, CONNECTION, payload)).toEqual({
      status: 'failed',
    })
    expect(await rig.email.requestVerification('stranger@example.test', CONNECTION)).toEqual({
      status: 'failed',
    })
    expect(rig.port.send).not.toHaveBeenCalled()
  })
  it('expires codes at fifteen minutes and refuses the sixth attempt', async () => {
    const expired = mailRig()
    await expired.email.requestVerification(ADDRESS, CONNECTION)
    const expiredCode = /\d{6}/.exec(expired.port.send.mock.calls[0]![1].text)![0]
    expired.advance(REPORT_EMAIL_CODE_TTL_MS)
    expect(await expired.email.verify(ADDRESS, expiredCode)).toBe(false)
    const attempts = mailRig()
    await attempts.email.requestVerification(ADDRESS, CONNECTION)
    const code = /\d{6}/.exec(attempts.port.send.mock.calls[0]![1].text)![0]
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect(await attempts.email.verify(ADDRESS, 'wrong')).toBe(false)
    expect(await attempts.email.verify(ADDRESS, code)).toBe(false)
    expect(attempts.store.state.challenges[ADDRESS]?.tries).toBe(5)
  })
  it('rejects a wrong six-digit code and malformed transport metadata', async () => {
    const rig = mailRig()
    await rig.email.requestVerification(ADDRESS, CONNECTION)
    expect(await rig.email.verify(ADDRESS, '000000')).toBe(false)
    rig.port.connectionPolicy.mockResolvedValue({
      connectedByUser: true,
      tls: 'false',
      certificateChecked: true,
    })
    await expect(rig.email.requestVerification(ADDRESS, CONNECTION)).rejects.toThrow(
      UI_TEXT.reportUi.tlsRequired,
    )
  })
  it('preserves a case-sensitive SMTP local part and folds only the domain', async () => {
    const rig = mailRig()
    rig.port.isRecipientAllowed.mockImplementation((address) =>
      Promise.resolve(address === 'Owner@example.test'),
    )
    await rig.email.requestVerification('Owner@EXAMPLE.TEST', CONNECTION)
    const message = rig.port.send.mock.calls[0]![1]
    expect(message.to).toBe('Owner@example.test')
    const code = /\d{6}/.exec(message.text)![0]
    expect(await rig.email.verify('Owner@EXAMPLE.TEST', code)).toBe(true)
    expect(await rig.email.isVerified('owner@example.test')).toBe(false)
  })
  it('requires exact first-send preview confirmation and never prompts during a fire', async () => {
    const rig = mailRig()
    await rig.verify()
    rig.port.send.mockClear()
    expect(await rig.email.send('one', 'email', ADDRESS, CONNECTION, deliveryPayload())).toEqual({
      status: 'failed',
    })
    expect(rig.port.send).not.toHaveBeenCalled()
    expect(rig.port.confirmFirstSend).not.toHaveBeenCalled()
    rig.port.confirmFirstSend.mockResolvedValue(false)
    expect(await rig.email.confirm(ADDRESS, deliveryPayload())).toBe(false)
    expect(await rig.email.send('one', 'email', ADDRESS, CONNECTION, deliveryPayload())).toEqual({
      status: 'failed',
    })
    rig.port.confirmFirstSend.mockResolvedValue(true)
    expect(await rig.email.confirm(ADDRESS, deliveryPayload())).toBe(true)
    expect(await rig.email.send('one', 'email', ADDRESS, CONNECTION, deliveryPayload())).toEqual({
      status: 'delivered',
    })
    expect(rig.port.send.mock.calls[0]![1]).toEqual(rig.port.confirmFirstSend.mock.calls.at(-1)![0])
    rig.port.confirmFirstSend.mockClear()
    expect(await rig.email.confirm(ADDRESS, deliveryPayload())).toBe(true)
    expect(rig.port.confirmFirstSend).not.toHaveBeenCalled()
  })
  it.each([
    { connectedByUser: true, tls: false, certificateChecked: true },
    { connectedByUser: true, tls: true, certificateChecked: false },
    { connectedByUser: false, tls: true, certificateChecked: true },
  ])('refuses insecure or unconnected transport %j', async (policy) => {
    const rig = mailRig()
    await rig.verify()
    await rig.email.confirm(ADDRESS, deliveryPayload())
    rig.port.send.mockClear()
    rig.port.connectionPolicy.mockResolvedValue(policy)
    expect(await rig.email.send('one', 'email', ADDRESS, CONNECTION, deliveryPayload())).toEqual({
      status: 'failed',
    })
    expect(rig.port.send).not.toHaveBeenCalled()
  })
  it.each(['gmail', 'outlook'] as const)(
    'uses the user-connected %s vault item without a token',
    async (provider) => {
      const rig = mailRig()
      await rig.verify()
      await rig.email.confirm(ADDRESS, deliveryPayload())
      const connection = { provider, vaultItemId: `user-${provider}` }
      await rig.email.send('one', 'email', ADDRESS, connection, deliveryPayload())
      expect(rig.port.send.mock.calls.at(-1)![0]).toEqual(connection)
      expect(rig.port.send.mock.calls.at(-1)![2].requester).toBe('schedule:one')
    },
  )
  it('scrubs planted canaries from body, text and attachment immediately before sending', async () => {
    const rig = mailRig()
    await rig.verify()
    const canary = 'ghp_' + 'a'.repeat(36)
    const payload = {
      ...deliveryPayload(),
      html: `<p>${canary}</p>`,
      text: canary,
      attachment: canary,
    }
    await rig.email.confirm(ADDRESS, payload)
    await rig.email.send('one', 'email', ADDRESS, CONNECTION, payload)
    const message = rig.port.send.mock.calls.at(-1)![1]
    expect(JSON.stringify(message)).not.toContain(canary)
    expect(message.html).toContain('[redacted]')
    expect(message.text).toContain('[redacted]')
    expect(message.attachment?.content).toContain('[redacted]')
  })
  it('keeps JSON attachment valid with its verified structural hash', () => {
    const rig = mailRig()
    const payload = deliveryPayload(undefined, 'json')
    const message = rig.email.message(ADDRESS, { ...payload, attachment: 'tampered bytes' })
    expect(JSON.parse(message.attachment!.content)).toEqual(payload.document)
  })
  it('returns uncertainty without raw SMTP errors when sending a verification code', async () => {
    const rig = mailRig()
    rig.port.send.mockRejectedValue(new Error('ghp_' + 'a'.repeat(36)))
    expect(await rig.email.requestVerification(ADDRESS, CONNECTION)).toEqual({
      status: 'uncertain',
    })
  })
  it('enforces six per rolling hour across instances, counting verification and failures', async () => {
    const rig = mailRig()
    await rig.verify()
    await rig.email.confirm(ADDRESS, deliveryPayload())
    const another = new ReportEmailDelivery(rig.port, rig.store, () =>
      Date.parse('2026-10-06T12:00:00Z'),
    )
    rig.port.send.mockClear()
    for (let n = 1; n < REPORT_EMAIL_PER_HOUR; n += 1) {
      const deliveryResult1 = await another.send(
        'one',
        `email-${String(n)}`,
        ADDRESS,
        CONNECTION,
        deliveryPayload(),
      )
      expect(deliveryResult1.status).toBe('delivered')
    }
    const deliveryResult2 = await rig.email.send(
      'one',
      'blocked',
      ADDRESS,
      CONNECTION,
      deliveryPayload(),
    )
    expect(deliveryResult2.status).toBe('failed')
    expect(rig.port.send).toHaveBeenCalledTimes(REPORT_EMAIL_PER_HOUR - 1)
    rig.advance(REPORT_DELIVERY_HOUR_MS)
    const deliveryResult3 = await rig.email.send(
      'one',
      'later',
      ADDRESS,
      CONNECTION,
      deliveryPayload(),
    )
    expect(deliveryResult3.status).toBe('delivered')
  })
  it('enforces twenty per rolling day and retains reservations for uncertain replies', async () => {
    const rig = mailRig()
    await rig.verify()
    await rig.email.confirm(ADDRESS, deliveryPayload())
    rig.port.send.mockResolvedValue({ status: 'uncertain' })
    for (let n = 1; n < REPORT_EMAIL_PER_DAY; n += 1) {
      rig.advance(REPORT_DELIVERY_HOUR_MS)
      const deliveryResult4 = await rig.email.send(
        'one',
        `email-${String(n)}`,
        ADDRESS,
        CONNECTION,
        deliveryPayload(),
      )
      expect(deliveryResult4.status).toBe('uncertain')
    }
    rig.advance(REPORT_DELIVERY_HOUR_MS)
    const calls = rig.port.send.mock.calls.length
    const deliveryResult5 = await rig.email.send(
      'one',
      'blocked',
      ADDRESS,
      CONNECTION,
      deliveryPayload(),
    )
    expect(deliveryResult5.status).toBe('failed')
    expect(rig.port.send).toHaveBeenCalledTimes(calls)
  })
})
