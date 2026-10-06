import type { AgentEvent, ApprovalChoice, ApprovalSubject } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import {
  approvalHardwareAction,
  scrubHardwareApproval,
  markHardwareApproval,
} from '../agent/approvalHardware'
import { isDeviceAction, isPhysicalTool } from './guard/actionClass'
import { hardwareTarget } from './guard/hardwareCommands'
import type { HardwareContext } from './guard/httpCommands'
import { parseShell } from './guard/shellParse'
import { HardwareApproval } from './ports'

type Card = Extract<AgentEvent, { type: 'approvalRequested' | 'approvalUpdated' }>

/** MSP's hardware state stays lazy, including its expiry and failed-decision protection. */
export class SessionHardwareGuard {
  private readonly approvals = new Map<string, HardwareApproval>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  public constructor(
    private readonly context: () => HardwareContext,
    private readonly pending: (id: string) => Card | undefined,
    private readonly reject: (id: string) => void,
  ) {}

  private key(id: string, index: number): string {
    return `${id}\u{0}${String(index)}`
  }

  private payload(event: Card): string {
    const current = this.pending(event.approvalId)
    const rawArgs = 'rawArgs' in event ? event.rawArgs : undefined
    const previous = current !== undefined && 'rawArgs' in current ? current.rawArgs : undefined
    return JSON.stringify({ subject: event.subject, rawArgs: rawArgs ?? previous })
  }

  public scrub(event: Card, toolName: string | undefined): Card {
    return scrubHardwareApproval(
      isPhysicalTool(toolName ?? '')
        ? { ...event, subject: { ...event.subject, toolName } }
        : event,
      this.context(),
    )
  }

  /** Return false when a refused action must not reach any approval surface. */
  public admit(event: Card): boolean {
    const key = this.key(event.approvalId, event.requirementId.sourceIndex)
    const action = approvalHardwareAction(event.subject, this.context())
    let approval = this.approvals.get(key)
    if (approval === undefined && isDeviceAction(action)) {
      approval = new HardwareApproval(
        event.approvalId,
        this.payload(event),
        hardwareTarget(
          event.subject.command ?? event.subject.toolName ?? event.subject.kind,
          'bash',
          this.context(),
        ),
        action ?? 'actuate',
        Date.now(),
        JSON.stringify({
          parsed: parseShell(event.subject.command ?? '', 'bash'),
          stages: event.subject.stages?.map((stage) => stage.argv),
        }),
      )
      this.approvals.set(key, approval)
    }
    if (approval === undefined) return true
    markHardwareApproval(event)
    if (approval.request.action === 'refused') {
      this.reject(event.approvalId)
      return false
    }
    if (!this.timers.has(key)) {
      this.timers.set(
        key,
        setTimeout(
          () => {
            if (
              this.pending(event.approvalId)?.requirementId.sourceIndex ===
              event.requirementId.sourceIndex
            )
              this.reject(event.approvalId)
            this.timers.delete(key)
            // Keep the expired/consumed binding even when rejection itself fails.
          },
          Math.max(0, approval.request.expiresAt - Date.now()),
        ),
      )
    }
    return true
  }

  public validate(
    key: string,
    id: string,
    offered: ApprovalChoice | undefined,
    subject: ApprovalSubject | undefined,
  ): void {
    const approval = this.approvals.get(key)
    if (approval === undefined) return
    const current = this.pending(id)
    if (offered === undefined || subject === undefined || current === undefined)
      throw new Error(UI_TEXT.hardwareRefused)
    if (
      offered.decision === 'approved' &&
      approval.request.payload !== this.payload({ ...current, subject })
    )
      throw new Error(UI_TEXT.hardwareRefused)
    if (
      offered.decision === 'approved' &&
      !approval.accept(
        { id, digest: approval.request.digest, decision: 'sendOnce' },
        hardwareTarget(subject.command ?? subject.toolName ?? subject.kind, 'bash', this.context()),
        Date.now(),
      )
    )
      throw new Error(UI_TEXT.hardwareExpired)
  }

  public settled(key: string): void {
    this.approvals.delete(key)
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
  }

  public dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.approvals.clear()
  }
}
