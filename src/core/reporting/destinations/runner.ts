import { createHash } from 'node:crypto'
import {
  REPORT_DELIVERY_ATTEMPTS,
  REPORT_DELIVERY_RETRY_MS,
  UI_TEXT,
} from '../../../shared/constants'
import { reportOptionsSchema } from '../../../shared/reportSchema'
import { createReportRenderers } from '../render'
import { verifyReport } from '../render/canonical'
import type { ReportLocalePort } from '../render/display'
import { reportScrubber, type ReportRedaction } from '../render/redaction'
import { openReportInBrowser, type ReportBrowserPort } from './browser'
import { type ReportEmailDelivery } from './email'
import { type ReportPostDelivery } from './post'
import { saveReport, ReportSaveRefusedError, type ReportSaveAdmission } from './save'
import {
  scheduledReportActionSchema,
  reportOccurrenceRecordSchema,
  type ReportDeliveryOutcome,
  type ReportDeliveryPayload,
  type ReportDestination,
  type ReportGenerationPort,
  type ReportOccurrencePort,
  type ReportScheduleAuthorityPort,
  type ScheduledReportAction,
} from './types'

export interface ScheduledReportPorts {
  readonly authority: ReportScheduleAuthorityPort
  readonly generation: ReportGenerationPort
  readonly occurrences: ReportOccurrencePort
  readonly locale: ReportLocalePort
  readonly redaction: ReportRedaction
  readonly email: ReportEmailDelivery
  readonly post: ReportPostDelivery
  readonly browser: ReportBrowserPort
  // M115/M110 serialize the canonical root across occurrences/destinations.
  // The owner checks the action generation and live grant synchronously; a
  // revoked/stale effect throws ReportSaveRefusedError. Hold ownership to settlement.
  saveExclusive<T>(
    scheduleId: string,
    destination: Extract<ReportDestination, { type: 'save' }>,
    actionKey: string,
    work: (assertCurrent: () => void) => Promise<T>,
  ): Promise<T>
  // M110 calls saveReport on its own volume, under the same root lease and grant.
  readonly nodeSave: (
    scheduleId: string,
    destination: Extract<ReportDestination, { type: 'save' }>,
    payload: ReportDeliveryPayload,
    roots: readonly string[],
    admission: ReportSaveAdmission,
  ) => Promise<void>
  readonly sleep: (ms: number) => Promise<void>
}
function validatedAction(input: unknown): ScheduledReportAction {
  const validation = scheduledReportActionSchema.safeParse(input)
  if (!validation.success) throw new Error(UI_TEXT.reportUi.generationFailed)
  return validation.data
}
export class ScheduledReportRunner {
  constructor(private readonly ports: ScheduledReportPorts) {}

  private render(action: ScheduledReportAction, document: unknown): ReportDeliveryPayload {
    const checked = verifyReport(document, this.ports.redaction)
    const render = createReportRenderers(this.ports.locale, this.ports.redaction)
    return {
      document: checked,
      format: action.format,
      locale: action.locale,
      theme: action.theme,
      attachment: render[action.format](checked, action.locale, action.theme),
      html: render.html(checked, action.locale, action.theme),
      text: render.text(checked, action.locale, action.theme),
      markdown: render.md(checked, action.locale, action.theme),
    }
  }

  private async deliver(
    scheduleId: string,
    action: ScheduledReportAction,
    destination: ReportDestination,
    payload: ReportDeliveryPayload,
  ): Promise<ReportDeliveryOutcome> {
    for (let attempt = 1; attempt <= REPORT_DELIVERY_ATTEMPTS; attempt += 1) {
      try {
        const authority = await this.ports.authority.authorize(scheduleId, action)
        if (!authority.allowed) return { status: 'refused', attempts: attempt - 1 }
        const roots = authority.roots
        if (destination.type === 'save') {
          await this.ports.saveExclusive(
            scheduleId,
            destination,
            createHash('sha256').update(JSON.stringify(action)).digest('hex'),
            async (assertCurrent) => {
              const admission: ReportSaveAdmission = {
                assertCurrent,
                recheck: async () => {
                  const current = await this.ports.authority.authorize(scheduleId, action)
                  return current.allowed ? current.roots : null
                },
              }
              if (destination.storage === 'node')
                await this.ports.nodeSave(scheduleId, destination, payload, roots, admission)
              else await saveReport(scheduleId, destination, payload, roots, admission)
            },
          )
          return { status: 'delivered', attempts: attempt }
        }
        if (destination.type === 'browser') {
          const opened = await openReportInBrowser(
            this.ports.browser,
            scheduleId,
            payload,
            destination.storage,
          )
          return opened === 'opened'
            ? { status: 'delivered', attempts: attempt }
            : { status: 'deferred', attempts: attempt, reason: 'inactiveSession' }
        }
        const receipt =
          destination.type === 'email'
            ? await this.ports.email.send(
                scheduleId,
                destination.id,
                destination.address,
                destination.connection,
                payload,
              )
            : await this.ports.post.post(scheduleId, destination.id, destination.target, payload)
        if (receipt.status === 'delivered') return { status: 'delivered', attempts: attempt }
        if (receipt.status === 'failed' || receipt.status === 'uncertain')
          return { status: receipt.status, attempts: attempt }
        if (attempt === REPORT_DELIVERY_ATTEMPTS) return { status: 'failed', attempts: attempt }
        await this.ports.sleep(REPORT_DELIVERY_RETRY_MS * attempt)
      } catch (error: unknown) {
        if (error instanceof ReportSaveRefusedError) return { status: 'refused', attempts: attempt }
        // Raw SMTP/OAuth/GitHub errors can contain secrets or account details.
        // Without a parsed pre-dispatch receipt, the send's outcome is unknown.
        return { status: destination.type === 'save' ? 'failed' : 'uncertain', attempts: attempt }
      }
    }
    return { status: 'failed', attempts: REPORT_DELIVERY_ATTEMPTS }
  }

  /** Called in the interactive schedule editor, never by an unattended fire. */
  async prepare(scheduleId: string, input: unknown): Promise<boolean> {
    const action = validatedAction(input)
    const authority = await this.ports.authority.authorize(scheduleId, action)
    if (!authority.allowed) return false
    for (const destination of action.destinations) {
      if (destination.type === 'email' && !(await this.ports.email.isVerified(destination.address)))
        return false
    }
    const payload = this.render(
      action,
      await this.ports.generation.generate({
        ...action.options,
        network: action.options.network && authority.network,
      }),
    )
    for (const destination of action.destinations) {
      if (
        destination.type === 'email' &&
        !(await this.ports.email.confirm(destination.address, payload))
      )
        return false
      if (
        destination.type === 'post' &&
        !(await this.ports.post.confirm(destination.target, payload))
      )
        return false
    }
    return true
  }

  async run(
    scheduleId: string,
    occurrence: string,
    input: unknown,
  ): Promise<Readonly<Record<string, ReportDeliveryOutcome>>> {
    const action = validatedAction(input)
    const options = reportOptionsSchema.parse({ ...action.options, asOf: occurrence })
    return await this.ports.occurrences.exclusive(scheduleId, occurrence, async () => {
      const authority = await this.ports.authority.authorize(scheduleId, action)
      if (!authority.allowed)
        return Object.fromEntries(
          action.destinations.map((item) => [item.id, { status: 'refused', attempts: 0 }]),
        )
      const actionKey = createHash('sha256').update(JSON.stringify(action)).digest('hex')
      const saved = await this.ports.occurrences.read(scheduleId, occurrence)
      const validation = saved === null ? null : reportOccurrenceRecordSchema.safeParse(saved)
      if (validation !== null && !validation.success)
        throw new Error(UI_TEXT.reportUi.generationFailed)
      const previous = validation?.data ?? null
      if (previous !== null && previous.actionKey !== actionKey)
        throw new Error(UI_TEXT.reportUi.generationFailed)
      const document =
        previous?.payload.document ??
        (await this.ports.generation.generate({
          ...options,
          network: options.network && authority.network,
        }))
      const payload = previous?.payload ?? this.render(action, document)
      if (previous !== null) verifyReport(payload.document, this.ports.redaction)
      if (
        payload.document.header.asOf !== occurrence ||
        payload.document.header.kind !== options.kind ||
        payload.document.header.scope !== reportScrubber(this.ports.redaction)(options.scope) ||
        payload.format !== action.format ||
        payload.locale !== action.locale ||
        JSON.stringify(payload.theme) !== JSON.stringify(action.theme)
      )
        throw new Error(UI_TEXT.reportUi.generationFailed)
      const outcomes: Record<string, ReportDeliveryOutcome> = { ...previous?.outcomes }
      if (Object.keys(outcomes).some((id) => action.destinations.every((item) => item.id !== id)))
        throw new Error(UI_TEXT.reportUi.generationFailed)
      await this.ports.occurrences.write(scheduleId, occurrence, { actionKey, payload, outcomes })
      for (const destination of action.destinations) {
        // Failure/uncertainty are terminal. A deferred browser may resume when
        // the user returns; successful destinations are never sent twice.
        if (
          Object.hasOwn(outcomes, destination.id) &&
          outcomes[destination.id]?.status !== 'deferred'
        )
          continue
        const current = await this.ports.authority.authorize(scheduleId, action)
        let result: ReportDeliveryOutcome = { status: 'refused', attempts: 0 }
        if (current.allowed) {
          // Persist uncertainty BEFORE dispatch: a process crash after dispatch
          // cannot make a later fire silently send the message again.
          outcomes[destination.id] = { status: 'uncertain', attempts: 0 }
          await this.ports.occurrences.write(scheduleId, occurrence, {
            actionKey,
            payload,
            outcomes,
          })
          result = await this.deliver(scheduleId, action, destination, payload)
        }
        outcomes[destination.id] = result
        await this.ports.occurrences.write(scheduleId, occurrence, { actionKey, payload, outcomes })
      }
      return outcomes
    })
  }
}
