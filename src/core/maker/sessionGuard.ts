import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { AgentEvent, ApprovalChoice, ApprovalSubject } from '../../shared/agentEvents'
import { MAX_DOCUMENT_BYTES, UI_TEXT } from '../../shared/constants'
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
import { HardwareApproval, type ApprovalRequest, type TargetIdentity } from './ports'

type Card = Extract<AgentEvent, { type: 'approvalRequested' | 'approvalUpdated' }>

/** In-process only. Never accepted from tool arguments or sent as an invented wire field. */
export interface HardwareBinding {
  readonly request: ApprovalRequest
  readonly assertCanStart: () => void
}

/** Read project markers once, before any session command can be admitted. */
function hasMakerProject(root: string | undefined): boolean {
  if (root === undefined) return false
  try {
    const entries = readdirSync(root, { withFileTypes: true })
    if (
      entries.some(
        (entry) =>
          (entry.isFile() || entry.isSymbolicLink()) &&
          /^(?:platformio\.ini|sdkconfig(?:\.defaults)?|pico_sdk_import\.cmake)$|\.ino$/i.test(
            entry.name,
          ),
      )
    )
      return true
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !/^(?:\.|node_modules|vendor|dist|build)/.test(entry.name) &&
        readdirSync(path.join(root, entry.name), { withFileTypes: true }).some(
          (file) => (file.isFile() || file.isSymbolicLink()) && /\.ino$/i.test(file.name),
        )
      )
        return true
    }
    if (entries.every((entry) => !(entry.isFile() && entry.name === 'CMakeLists.txt'))) return false
    const cmake = path.join(root, 'CMakeLists.txt')
    return (
      statSync(cmake).size > MAX_DOCUMENT_BYTES ||
      /IDF_PATH|pico_sdk_import|pico_sdk_init/.test(readFileSync(cmake, 'utf8'))
    )
  } catch (error: unknown) {
    // A workspace that cannot be inspected cannot establish ordinary mode.
    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
  }
}

function isStop(subject: ApprovalSubject, context: HardwareContext): boolean {
  return (
    subject.kind === 'shell' &&
    subject.command !== undefined &&
    subject.stages === undefined &&
    isHardwareStop(subject.command, 'bash', context)
  )
}

/** MSP's hardware state stays lazy, including its expiry and failed-decision protection. */
export class SessionHardwareGuard {
  private readonly approvals = new Map<string, HardwareApproval>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private isLatched = false
  private lastObservation = ''
  private activeCommands = 0
  private readonly stopObserving: (() => void) | undefined

  public constructor(
    private readonly context: () => HardwareContext,
    private readonly pending: (id: string) => Card | undefined,
    private readonly reject: (id: string) => void,
  ) {
    const initial = context()
    this.isLatched = hasMakerProject(initial.workspaceRoot)
    this.observe(initial)
    this.stopObserving = initial.onHardwareObserved?.((observed) => {
      this.observe(observed)
    })
  }

  private observation(context: HardwareContext): string {
    return JSON.stringify({
      workspace: context.isHardwareWorkspace,
      maker: context.isMakerEnabled,
      project: context.isHardwareProject,
      board: context.hasConnectedBoard,
      targets: context.targets,
      roots: context.boardRoots,
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
    // A session output tag is not inventory evidence from a host observation.
    const { hardwareSessionLatched: _previousSession, ...evidence } = context
    this.isLatched ||= isHardwareWorkspace(evidence)
    this.lastObservation = this.observation(context)
  }

  public current(): HardwareContext {
    const live = this.context()
    if (this.observation(live) !== this.lastObservation) this.observe(live)
    return { ...live, isHardwareWorkspace: this.isLatched, hardwareSessionLatched: this.isLatched }
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
    this.isLatched = false
    this.lastObservation = this.observation(live)
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
    if (this.current().isUnattended === true) return undefined
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
              target.usbSerial !== approval.request.targets[index].usbSerial,
          )
        )
          throw new Error(UI_TEXT.hardwareExpired)
      },
    })
  }

  public scrub(event: Card, toolName: string | undefined): Card {
    return scrubHardwareApproval(
      isPhysicalTool(toolName ?? '')
        ? { ...event, subject: { ...event.subject, toolName } }
        : event,
      this.current(),
    )
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
    if (offered?.decision === 'abort' || offered?.decision === 'deny') return
    const context = this.current()
    if (subject !== undefined && isStop(subject, context)) return
    if (
      subject !== undefined &&
      subject.kind !== 'shell' &&
      isDeviceAction(approvalHardwareAction(subject, context))
    )
      throw new Error(UI_TEXT.hardwareBindingUnavailable)
    const pending = this.pending(id)
    if (
      (context.isUnattended === true ||
        (pending !== undefined &&
          'permissionMode' in pending &&
          pending.permissionMode === 'bypassPermissions')) &&
      (isHardwareWorkspace(context) ||
        (subject !== undefined && isDeviceAction(approvalHardwareAction(subject, context))))
    )
      throw new Error(UI_TEXT.hardwareUnattended)
    if (subject?.kind === 'shell' && isHardwareWorkspace(context) && offered?.scope !== 'once')
      throw new Error(UI_TEXT.hardwareRefused)
    const approval = this.approvals.get(key)
    if (approval === undefined) {
      if (
        subject !== undefined &&
        (isDeviceAction(approvalHardwareAction(subject, context)) ||
          (subject.kind === 'shell' && isHardwareWorkspace(context)))
      )
        throw new Error(UI_TEXT.hardwareRefused)
      return
    }
    const current = this.pending(id)
    if (offered === undefined || subject === undefined || current === undefined)
      throw new Error(UI_TEXT.hardwareRefused)
    if (offered.decision === 'approved' && offered.scope !== 'once')
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
        hardwareTargets(
          subject.command ?? subject.target ?? subject.host ?? subject.toolName ?? subject.kind,
          'bash',
          context,
          subject.stages?.map((stage) => stage.argv),
        ),
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
    this.stopObserving?.()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.approvals.clear()
  }
}
