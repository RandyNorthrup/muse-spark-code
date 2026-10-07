import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import * as z from 'zod/mini'
import {
  REPORT_DELIVERY_DAY_MS,
  REPORT_DELIVERY_HOUR_MS,
  REPORT_EMAIL_CODE_DIGITS,
  REPORT_EMAIL_CODE_MAX,
  REPORT_EMAIL_CODE_MIN,
  REPORT_EMAIL_CODE_SALT_BYTES,
  REPORT_EMAIL_CODE_TRIES,
  REPORT_EMAIL_CODE_TTL_MS,
  REPORT_EMAIL_PER_DAY,
  REPORT_EMAIL_PER_HOUR,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { reportScrubber, type ReportRedaction } from '../render/redaction'
import { canonicalReportJson } from '../render/canonical'
import {
  reportConnectionSchema,
  reportDeliveryReceiptSchema,
  reportEmailAddressSchema,
  type ReportDeliveryPayload,
  type ReportDeliveryReceipt,
  type ReportMailConnection,
} from './types'

export interface ReportMailMessage {
  readonly to: string
  readonly subject: string
  readonly html: string
  readonly text: string
  readonly attachment: { readonly name: string; readonly content: string } | null
}
const challengeSchema = z.strictObject({
  salt: z.string(),
  digest: z.string(),
  expiresAt: z.number(),
  tries: z.number().check(z.int(), z.nonnegative()),
})
const connectionPolicySchema = z.strictObject({
  connectedByUser: z.boolean(),
  tls: z.boolean(),
  certificateChecked: z.boolean(),
})
export const reportMailStateSchema = z.strictObject({
  challenges: z.record(z.string(), challengeSchema),
  verified: z.array(reportEmailAddressSchema),
  confirmed: z.array(reportEmailAddressSchema),
  // Reservations include failed/uncertain attempts and verification mail. A
  // restart cannot erase an uncertain send's liability or bypass either cap.
  reservations: z.array(z.number()),
})
export type ReportMailState = z.infer<typeof reportMailStateSchema>
export interface ReportMailStatePort {
  // M109/M115 bind an owner-only persistent transaction, serialized across windows.
  update<T>(
    change: (state: ReportMailState) => { readonly state: ReportMailState; readonly value: T },
  ): Promise<T>
}
export interface ReportMailPort {
  // User-maintained own-addresses/allow-list; agents have no mutation method.
  isRecipientAllowed(address: string): Promise<boolean>
  connectionPolicy(connection: ReportMailConnection): Promise<unknown>
  // The broker resolves the opaque vault id; no credential enters this module.
  // It must enforce TLS/certificate validation at dispatch, not merely in metadata.
  send(
    connection: ReportMailConnection,
    message: ReportMailMessage,
    context: {
      readonly requester: string
      readonly idempotencyKey: string
      readonly requireTls: true
      readonly rejectUnauthorized: true
    },
  ): Promise<unknown>
  confirmFirstSend(message: ReportMailMessage): Promise<boolean>
}
function addressKey(address: string): string {
  // SMTP local parts may be case sensitive. Only the domain is case folded.
  return reportEmailAddressSchema
    .parse(address)
    .replace(/@[^@]+$/, (domain) => domain.toLowerCase())
}
function codeDigest(salt: string, code: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex')
}

export class ReportEmailDelivery {
  constructor(
    private readonly port: ReportMailPort,
    private readonly store: ReportMailStatePort,
    private readonly now: () => number,
    private readonly redaction: ReportRedaction = {},
  ) {}

  private async connectionAllowed(connection: ReportMailConnection): Promise<boolean> {
    try {
      const validation = connectionPolicySchema.safeParse(
        await this.port.connectionPolicy(reportConnectionSchema.parse(connection)),
      )
      if (validation.success)
        return (
          validation.data.connectedByUser &&
          validation.data.tls &&
          validation.data.certificateChecked
        )
    } catch {
      // Provider details and unknown schema keys never escape the interactive boundary.
    }
    throw new Error(UI_TEXT.reportUi.tlsRequired)
  }

  private async reserve(): Promise<boolean> {
    const time = this.now()
    return await this.store.update((input) => {
      const state = reportMailStateSchema.parse(input)
      const reservations = state.reservations.filter(
        (stamp) => stamp > time - REPORT_DELIVERY_DAY_MS,
      )
      // Future reservations remain counted if the clock moves backwards.
      const isAllowed =
        reservations.length < REPORT_EMAIL_PER_DAY &&
        reservations.filter((stamp) => stamp > time - REPORT_DELIVERY_HOUR_MS).length <
          REPORT_EMAIL_PER_HOUR
      if (isAllowed) reservations.push(time)
      return { state: { ...state, reservations }, value: isAllowed }
    })
  }

  /** Called only on the user's Verify click; agents cannot add recipients or send codes. */
  async requestVerification(
    address: string,
    connection: ReportMailConnection,
  ): Promise<ReportDeliveryReceipt> {
    const recipient = addressKey(address)
    if (
      !(await this.port.isRecipientAllowed(recipient)) ||
      !(await this.connectionAllowed(connection))
    )
      return { status: 'failed' }
    if (!(await this.reserve())) return { status: 'failed' }
    const code = randomInt(REPORT_EMAIL_CODE_MIN, REPORT_EMAIL_CODE_MAX).toString()
    const salt = randomBytes(REPORT_EMAIL_CODE_SALT_BYTES).toString('hex')
    const expiresAt = this.now() + REPORT_EMAIL_CODE_TTL_MS
    await this.store.update((state) => ({
      state: {
        ...reportMailStateSchema.parse(state),
        challenges: {
          ...state.challenges,
          [recipient]: { salt, digest: codeDigest(salt, code), expiresAt, tries: 0 },
        },
      },
      value: undefined,
    }))
    const text = fill(UI_TEXT.reportUi.verificationMessage, { code })
    const message: ReportMailMessage = {
      to: recipient,
      subject: UI_TEXT.reportUi.verifyCode,
      text,
      html: `<p>${text}</p>`,
      attachment: null,
    }
    try {
      return reportDeliveryReceiptSchema.parse(
        await this.port.send(connection, message, {
          requester: 'report:verify-recipient',
          idempotencyKey: salt,
          requireTls: true,
          rejectUnauthorized: true,
        }),
      )
    } catch {
      return { status: 'uncertain' }
    }
  }

  async verify(address: string, code: string): Promise<boolean> {
    const recipient = addressKey(address)
    if (!(await this.port.isRecipientAllowed(recipient))) return false
    return await this.store.update((input) => {
      const state = reportMailStateSchema.parse(input)
      const challenge = state.challenges[recipient]
      if (
        challenge === undefined ||
        this.now() >= challenge.expiresAt ||
        challenge.tries >= REPORT_EMAIL_CODE_TRIES
      )
        return { state, value: false }
      const actual = Buffer.from(codeDigest(challenge.salt, code), 'hex')
      const expected = Buffer.from(challenge.digest, 'hex')
      const isValid =
        code.length === REPORT_EMAIL_CODE_DIGITS &&
        /^\d+$/.test(code) &&
        actual.length === expected.length &&
        timingSafeEqual(actual, expected)
      const challenges = { ...state.challenges }
      if (isValid) Reflect.deleteProperty(challenges, recipient)
      else challenges[recipient] = { ...challenge, tries: challenge.tries + 1 }
      return {
        state: {
          ...state,
          challenges,
          verified: isValid ? [...new Set([...state.verified, recipient])] : state.verified,
        },
        value: isValid,
      }
    })
  }

  async isVerified(address: string): Promise<boolean> {
    const recipient = addressKey(address)
    return (
      (await this.port.isRecipientAllowed(recipient)) &&
      (await this.store.update((state) => ({
        state,
        value: reportMailStateSchema.parse(state).verified.includes(recipient),
      })))
    )
  }

  message(address: string, payload: ReportDeliveryPayload): ReportMailMessage {
    const scrub = reportScrubber(this.redaction)
    return {
      to: addressKey(address),
      subject: UI_TEXT.reportUi.title,
      html: scrub(payload.html),
      text: scrub(payload.text),
      attachment: {
        name: `${payload.document.header.kind}.${payload.format === 'text' ? 'txt' : payload.format}`,
        content:
          payload.format === 'json'
            ? canonicalReportJson(payload.document, this.redaction)
            : scrub(payload.attachment),
      },
    }
  }

  // Prepare the exact redacted message in the interactive schedule editor. An
  // unattended fire only observes remembered user confirmation and never waits.
  async confirm(address: string, payload: ReportDeliveryPayload): Promise<boolean> {
    const recipient = addressKey(address)
    if (!(await this.isVerified(recipient))) return false
    const isConfirmed = await this.store.update((state) => ({
      state,
      value: reportMailStateSchema.parse(state).confirmed.includes(recipient),
    }))
    if (isConfirmed) return true
    if (!(await this.port.confirmFirstSend(this.message(recipient, payload)))) return false
    await this.store.update((state) => ({
      state: { ...state, confirmed: [...new Set([...state.confirmed, recipient])] },
      value: undefined,
    }))
    return true
  }

  async send(
    scheduleId: string,
    destinationId: string,
    address: string,
    connection: ReportMailConnection,
    payload: ReportDeliveryPayload,
  ): Promise<ReportDeliveryReceipt> {
    const recipient = addressKey(address)
    if (!(await this.isVerified(recipient)) || !(await this.connectionAllowed(connection)))
      return { status: 'failed' }
    const isConfirmed = await this.store.update((state) => ({
      state,
      value: reportMailStateSchema.parse(state).confirmed.includes(recipient),
    }))
    if (!isConfirmed || !(await this.reserve())) return { status: 'failed' }
    return reportDeliveryReceiptSchema.parse(
      await this.port.send(connection, this.message(recipient, payload), {
        requester: `schedule:${scheduleId}`,
        idempotencyKey: `${scheduleId}:${payload.document.header.asOf}:${destinationId}`,
        requireTls: true,
        rejectUnauthorized: true,
      }),
    )
  }
}
