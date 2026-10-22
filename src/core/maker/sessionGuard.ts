import { HardwareWorkspace } from './hardwareContext'
import type { AgentEvent, ApprovalChoice, ApprovalSubject } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import {
  approvalHardwareAction,
  scrubHardwareApproval,
  markHardwareApproval,
} from '../agent/approvalHardware'
import { isDeviceAction, isPhysicalTool } from './guard/actionClass'
import { hardwareTargets, isHardwareStop } from './guard/hardwareCommands'
import type { HardwareContext } from './guard/httpCommands'
import { isHardwareWorkspace } from './guard/shellPolicy'
import { parseShell } from './guard/shellParse'
import { HardwareApproval, type HardwareApprovalRequest, type TargetIdentity } from './ports'

type Card = Extract<AgentEvent, { type: 'approvalRequested' | 'approvalUpdated' }>

/** In-process only. Never accepted from tool arguments or sent as an invented wire field. */
export interface HardwareBinding {
  readonly request: HardwareApprovalRequest
  readonly assertCanStart: () => void
}

function isStop(subject: ApprovalSubject, context: HardwareContext): boolean {
  return (
    subject.kind === 'shell' &&
    subject.command !== undefined &&
    isHardwareStop(subject.command, 'bash', context)
  )
}

function isHardwareRefused(event: Card, context: HardwareContext): boolean {
  return (
    !isHardwareWorkspace(context) && approvalHardwareAction(event.subject, context) === 'refused'
  )
}

/** MSP's hardware state stays lazy, including its expiry and failed-decision protection. */
export class SessionHardwareGuard {
  private readonly approvals = new Map<string, HardwareApproval>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly owner: HardwareWorkspace
  private activeCommands = 0
  private readonly stopActivity: () => void
  private readonly stopObserving: (() => void) | undefined

  public constructor(
    private readonly context: () => HardwareContext,
    private readonly pending: (id: string) => Card | undefined,
    private readonly reject: (id: string) => void,
  ) {
    const initial = context()
    this.owner = initial.hardwareOwner ?? new HardwareWorkspace(context)
    this.stopActivity = this.owner.trackActivity(
      () =>
        this.activeCommands > 0 ||
        this.approvals.size > 0 ||
        this.context().isCommandActive === true ||
        this.context().hasActiveDeviceSession === true,
    )
    this.observe(initial)
    this.stopObserving = initial.onHardwareObserved?.((observed) => {
      this.observe(observed)
    })
  }

  private key(id: string, index: number): string {
    return `${id}\u{0}${String(index)}`
  }

  private payload(event: Card): string {
    const current = this.pending(event.approvalId)
    const rawArgs = 'rawArgs' in event ? event.rawArgs : undefined
    const previous = current !== undefined && 'rawArgs' in current ? current.rawArgs : undefined
    return JSON.stringify({ subject: event.subject, rawArgs: rawArgs ?? previous })
  }

  /** Inventory events latch on; no event or disappearing marker can latch off. */
  public observe(context: HardwareContext): void {
    this.owner.observe(context)
  }

  public current(): HardwareContext {
    return {
      ...this.context(),
      ...this.owner.current(),
      isUnattended: this.context().isUnattended === true,
    }
  }

  /** The host UI alone owns this method; neither tool arguments nor MSP expose it. */
  public turnOffFromHostUI(): void {
    const live = this.context()
    if (
      this.activeCommands > 0 ||
      this.approvals.size > 0 ||
      live.isCommandActive === true ||
      live.hasActiveDeviceSession === true
    )
      throw new Error(UI_TEXT.hardwareRefused)
    this.owner.reset()
  }

  /** Hold this lease through command/device-session completion, including background runs. */
  public beginCommand(): () => void {
    this.activeCommands += 1
    let isReleased = false
    return () => {
      if (!isReleased) this.activeCommands -= 1
      isReleased = true
    }
  }

  /** An accepted answer mints one immutable dispatch binding, consumed at native entry. */
  public authorize(
    approval: HardwareApproval,
    answer: unknown,
    liveTargets: () => readonly TargetIdentity[],
    now: () => number,
  ): HardwareBinding | undefined {
    if (this.current().isUnattended === true || this.current().isInventoryKnown === false)
      return undefined
    if (!approval.accept(answer, liveTargets(), now())) return undefined
    let isConsumed = false
    return Object.freeze({
      request: approval.request,
      assertCanStart: () => {
        if (isConsumed) throw new Error(UI_TEXT.hardwareExpired)
        isConsumed = true
        if (this.current().isUnattended === true) throw new Error(UI_TEXT.hardwareUnattended)
        const targets = liveTargets()
        if (
          now() >= approval.request.expiresAt ||
          targets.length !== approval.request.targets.length ||
          targets.some(
            (target, index) =>
              target.address !== approval.request.targets[index]?.address ||
              target.vidPid !== approval.request.targets[index].vidPid ||
              target.usbSerial !== approval.request.targets[index].usbSerial ||
              target.connectionId !== approval.request.targets[index].connectionId,
          )
        )
          throw new Error(UI_TEXT.hardwareExpired)
      },
    })
  }

  public scrub(event: Card, toolName: string | undefined): Card {
    const scrubbed = scrubHardwareApproval(
      isPhysicalTool(toolName ?? '')
        ? { ...event, subject: { ...event.subject, toolName } }
        : event,
      this.current(),
    )
    if (
      !isStop(scrubbed.subject, this.current()) &&
      (isDeviceAction(approvalHardwareAction(scrubbed.subject, this.current())) ||
        (scrubbed.subject.kind === 'shell' && isHardwareWorkspace(this.current())))
    )
      return {
        ...scrubbed,
        availableChoices: scrubbed.availableChoices.filter(
          (choice) => choice.decision === 'abort' || choice.decision === 'deny',
        ),
        note: UI_TEXT.hardwareBindingUnavailable,
      }
    return scrubbed
  }

  /** Return false when a refused action must not reach any approval surface. */
  public admit(event: Card): boolean {
    const context = this.current()
    // Stop goes straight back to the CLI, before unattended or approval admission.
    if (isStop(event.subject, context)) return true
    if (
      isHardwareWorkspace(context) &&
      event.subject.kind === 'shell' &&
      (context.isUnattended === true ||
        ('permissionMode' in event && event.permissionMode === 'bypassPermissions'))
    ) {
      this.reject(event.approvalId)
      return false
    }
    const key = this.key(event.approvalId, event.requirementId.sourceIndex)
    const action = approvalHardwareAction(event.subject, context)
    let approval = this.approvals.get(key)
    if (
      approval === undefined &&
      (isDeviceAction(action) || (event.subject.kind === 'shell' && isHardwareWorkspace(context)))
    ) {
      approval = new HardwareApproval(
        event.approvalId,
        this.payload(event),
        hardwareTargets(
          event.subject.command ??
            event.subject.target ??
            event.subject.host ??
            event.subject.toolName ??
            event.subject.kind,
          'bash',
          context,
          event.subject.stages?.map((stage) => stage.argv),
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
    if (isHardwareRefused(event, context)) {
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

  public validate(offered: ApprovalChoice | undefined, subject: ApprovalSubject | undefined): void {
    if (offered?.decision === 'abort' || offered?.decision === 'deny') return
    const context = this.current()
    if (
      subject !== undefined &&
      (isDeviceAction(approvalHardwareAction(subject, context)) ||
        isStop(subject, context) ||
        (subject.kind === 'shell' && isHardwareWorkspace(context)))
    )
      throw new Error(
        context.isUnattended === true && !isStop(subject, context)
          ? UI_TEXT.hardwareUnattended
          : UI_TEXT.hardwareBindingUnavailable,
      )
  }

  public settled(key: string): void {
    this.approvals.delete(key)
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
  }

  public dispose(): void {
    this.stopActivity()
    this.stopObserving?.()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.approvals.clear()
  }
}
