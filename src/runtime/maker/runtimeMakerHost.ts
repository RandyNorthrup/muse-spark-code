import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { UserPresence } from '../../core/maker/userPresence'
import { isSameMakerTarget } from '../../core/maker/ports'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type { MakerHost, MakerSecrets, MakerSerialProvider } from '../../core/maker/ports'
import {
  makerApprovalRequestSchema,
  makerApprovalAnswerSchema,
  makerHostMessageSchema,
  type ApprovalRequest,
  type MakerHostMessage,
  type MakerMachineSummary,
  type MakerNotice,
  type MakerPreview,
  type MakerSurfaceMessage,
  type MakerTarget,
} from '../../shared/makerProtocol'
import {
  RUNTIME_MAKER_STATE_KEY,
  MAKER_PRESENCE_GRANT_MS,
  RUNTIME_MAKER_TOKEN_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import { RuntimeMakerStorage } from './storage'

const grantSchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().check(z.minLength(1)),
  time: z.number(),
})
export interface RuntimeMakerHostDeps {
  readonly dataDirectory: string
  readonly workspace: string
  readonly secrets: MakerSecrets
  readonly trusted: () => boolean
  readonly flagged: () => boolean
  readonly interactive: () => boolean
  readonly serialProvider?: MakerSerialProvider
  readonly presence?: UserPresence
  readonly ask?: (request: ApprovalRequest) => Promise<unknown>
  readonly auditEnable: (reason: string) => Promise<void>
}

export class RuntimeMakerHost implements MakerHost {
  static async create(deps: RuntimeMakerHostDeps): Promise<RuntimeMakerHost> {
    const workspace = await realpath(deps.workspace)
    const root = path.join(deps.dataDirectory, 'maker')
    const machine = await RuntimeMakerStorage.create(root, workspace)
    const local = await RuntimeMakerStorage.create(
      path.join(root, 'workspaces', workspaceKey(workspace)),
      workspace,
    )
    const host = new RuntimeMakerHost(deps, { workspace: local, machine })
    await host.refresh()
    return host
  }
  /** Broken/unavailable grant storage must leave the companion's Stop usable, with authority off. */
  static stopOnly(deps: RuntimeMakerHostDeps): RuntimeMakerHost {
    const unavailable = {
      directory: path.join(deps.dataDirectory, 'maker'),
      get: () => Promise.reject(new Error('maker-authority-unavailable')),
      update: () => Promise.reject(new Error('maker-authority-unavailable')),
      delete: () => Promise.reject(new Error('maker-authority-unavailable')),
    }
    return new RuntimeMakerHost(
      { ...deps, trusted: () => false, flagged: () => false },
      {
        workspace: unavailable,
        machine: unavailable,
      },
    )
  }
  private enabled = false
  private enableGeneration = 0
  private readonly listeners = new Set<(message: MakerHostMessage) => void>()
  private readonly pending = new Map<
    string,
    {
      request: ApprovalRequest
      resolve: (answer: unknown) => void
      review: (raw: unknown) => boolean
      grant?: { value: string; expires: number }
    }
  >()
  private machines: readonly MakerMachineSummary[] = []
  private ports: readonly Extract<MakerTarget, { kind: 'serial' }>[] = []
  readonly secrets: MakerSecrets
  readonly serialProvider?: MakerSerialProvider
  private constructor(
    private readonly deps: RuntimeMakerHostDeps,
    readonly storage: MakerHost['storage'],
  ) {
    this.secrets = deps.secrets
    if (deps.serialProvider !== undefined) this.serialProvider = deps.serialProvider
  }
  private state() {
    return {
      v: 1,
      type: 'makerState',
      isTrusted: this.isTrusted(),
      hardwareEnabled: this.hardwareEnabled(),
      isInteractive: this.isInteractive(),
      machines: this.machines,
      ports: this.ports,
    }
  }
  private emit(raw: unknown): void {
    const message = makerHostMessageSchema.parse(raw)
    for (const listener of this.listeners) listener(message)
  }
  private async checkPresence(request: Parameters<UserPresence['check']>[0]): Promise<void> {
    let result: Awaited<ReturnType<UserPresence['check']>>
    try {
      result = (await this.deps.presence?.check(Object.freeze(request))) ?? 'unavailable'
    } catch {
      result = 'unavailable'
    }
    if (result !== 'approved')
      throw new Error(
        result === 'denied' ? UI_TEXT.makerPresenceDenied : UI_TEXT.makerPresenceUnavailable,
      )
  }
  isTrusted(): boolean {
    return this.deps.trusted()
  }
  hardwareEnabled(): boolean {
    return this.enabled && this.deps.flagged()
  }
  isInteractive(): boolean {
    return this.deps.interactive()
  }
  async refresh(): Promise<void> {
    this.enabled = false
    try {
      const raw = await this.storage.workspace.get(RUNTIME_MAKER_STATE_KEY)
      const grant = grantSchema.safeParse(raw)
      this.enabled = grant.success && grant.data.enabled
    } catch {
      // Unreadable authority stays off; it must not prevent independent Stop controls.
    }
    if (!this.hardwareEnabled() || !this.isTrusted() || !this.isInteractive())
      this.cancelApprovals()
  }
  async setHardware(isEnabled: boolean, reason?: string): Promise<void> {
    if (!isEnabled) {
      this.enableGeneration += 1
      this.enabled = false
      this.cancelApprovals()
      await this.storage.workspace.delete(RUNTIME_MAKER_STATE_KEY)
      return
    }
    if (!this.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
    if (!this.isInteractive()) throw new Error(UI_TEXT.makerUnattendedDenied)
    if (reason === undefined || reason.trim() === '') throw new Error(UI_TEXT.makerHardwareReason)
    this.enableGeneration += 1
    const generation = this.enableGeneration
    await this.requirePresence(UI_TEXT.makerEnableHardware, {
      enabled: true,
      reason: reason.trim(),
      workspace: this.deps.workspace,
    })
    if (generation !== this.enableGeneration || !this.isTrusted() || !this.isInteractive())
      throw new Error(UI_TEXT.makerUnattendedDenied)
    await this.deps.auditEnable(reason.trim())
    await this.storage.workspace.update(RUNTIME_MAKER_STATE_KEY, {
      enabled: isEnabled,
      reason: reason.trim(),
      time: Date.now(),
    })
    this.enabled = true
  }
  subscribe(listener: (message: MakerHostMessage) => void): () => void {
    this.listeners.add(listener)
    for (const { request } of this.pending.values())
      listener({ v: 1, type: 'makerApproval', request })
    listener(makerHostMessageSchema.parse(this.state()))
    return () => {
      this.listeners.delete(listener)
    }
  }
  /** Without the engine's review callback no payload review can succeed, so allow_once refuses. */
  async confirm(
    raw: ApprovalRequest,
    didReview: (raw: unknown) => boolean = () => false,
  ): Promise<unknown> {
    const request = makerApprovalRequestSchema.parse(raw)
    if (
      !this.isTrusted() ||
      !this.hardwareEnabled() ||
      !this.isInteractive() ||
      Date.now() >= request.expiresAt
    )
      return undefined
    if (this.pending.has(request.id)) return undefined
    const reject = {
      id: request.id,
      digest: request.digest,
      target: request.target,
      decision: 'reject_once',
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const pending = new Promise<unknown>((resolve) => {
        this.pending.set(request.id, { request, resolve, review: didReview })
        timer = setTimeout(
          () => {
            resolve(reject)
          },
          Math.max(0, request.expiresAt - Date.now()),
        )
      })
      this.emit({ v: 1, type: 'makerApproval', request })
      if (this.deps.ask !== undefined) {
        void this.deps
          .ask(request)
          .then(async (answer) => {
            const parsed = makerApprovalAnswerSchema.safeParse(answer).data
            // The editor prompt showed the whole request; its allow is the review of that digest.
            const grant =
              parsed?.decision === 'allow_once' &&
              parsed.id === request.id &&
              didReview({
                v: 1,
                type: 'makerPayloadReviewed',
                id: request.id,
                digest: parsed.digest,
                isComplete: true,
              })
                ? await this.authorize(answer)
                : undefined
            this.answer(grant ? answer : reject, grant)
          })
          .catch(() => {
            this.answer(reject)
          })
      }
      return await pending
    } finally {
      clearTimeout(timer)
      this.pending.delete(request.id)
      this.emit({ v: 1, type: 'makerApprovalClosed', id: request.id })
    }
  }
  async requirePresence(
    summary: string,
    payload: unknown,
    machine = this.deps.workspace,
  ): Promise<void> {
    await this.checkPresence({
      id: randomUUID(),
      digest: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      machine,
      summary,
    })
  }
  /** Only a pending, exact answer can prompt; the key is minted after OS authentication. */
  async authorize(raw: unknown): Promise<string | undefined> {
    const parsed = makerApprovalAnswerSchema.safeParse(raw)
    if (!parsed.success || parsed.data.decision !== 'allow_once') return undefined
    const answer = parsed.data
    const held = this.pending.get(answer.id)
    if (
      held === undefined ||
      held.grant !== undefined ||
      answer.digest !== held.request.digest ||
      !isSameMakerTarget(answer.target, held.request.target) ||
      Date.now() >= held.request.expiresAt
    )
      return undefined
    const target = held.request.target
    let machine: string
    switch (target.kind) {
      case 'machine': {
        machine = target.name
        break
      }
      case 'serial': {
        machine = target.port
        break
      }
      case 'workspace': {
        machine = target.workspace
        break
      }
    }
    const summaries = {
      observe: UI_TEXT.makerPresenceConnect,
      connect: UI_TEXT.makerPresenceConnect,
      program: UI_TEXT.makerPresenceProgram,
      actuate: UI_TEXT.makerPresenceActuate,
      stop: UI_TEXT.makerPresenceActuate,
    }
    await this.checkPresence({
      id: answer.id,
      digest: answer.digest,
      machine,
      summary: summaries[held.request.action],
    })
    if (
      this.pending.get(answer.id) !== held ||
      this.pending.get(answer.id)?.grant !== undefined ||
      !this.isTrusted() ||
      !this.hardwareEnabled() ||
      !this.isInteractive() ||
      Date.now() >= held.request.expiresAt
    )
      return undefined
    const value = randomBytes(RUNTIME_MAKER_TOKEN_BYTES).toString('hex')
    held.grant = { value, expires: performance.now() + MAKER_PRESENCE_GRANT_MS }
    return value
  }
  /** The surface's payload review reaches only the pending request's own MakerApproval check. */
  review(message: Extract<MakerSurfaceMessage, { type: 'makerPayloadReviewed' }>): boolean {
    return this.pending.get(message.id)?.review(message) ?? false
  }
  answer(raw: unknown, grant?: string): boolean {
    const parsed = makerApprovalAnswerSchema.safeParse(raw)
    const correlation = z.object({ id: z.uuid() }).safeParse(raw)
    if (!correlation.success) return false
    const held = this.pending.get(correlation.data.id)
    if (held === undefined) return false
    let isAllowed = parsed.success
    if (parsed.success && parsed.data.decision === 'allow_once') {
      const minted = held.grant
      const given = Buffer.from(grant ?? '')
      const expected = Buffer.from(minted?.value ?? '')
      isAllowed =
        minted !== undefined &&
        performance.now() < minted.expires &&
        given.length === expected.length &&
        timingSafeEqual(given, expected) &&
        parsed.data.digest === held.request.digest &&
        isSameMakerTarget(parsed.data.target, held.request.target) &&
        Date.now() < held.request.expiresAt &&
        this.isTrusted() &&
        this.hardwareEnabled() &&
        this.isInteractive()
      if (!isAllowed) return false
    }
    this.pending.delete(correlation.data.id)
    held.resolve(isAllowed ? raw : undefined)
    return isAllowed
  }
  cancelApprovals(): void {
    for (const { resolve } of this.pending.values()) resolve(undefined)
    this.pending.clear()
  }
  notify(notice: MakerNotice): void {
    this.emit({ v: 1, type: 'makerNotice', notice })
  }
  stopControls(machines: readonly MakerMachineSummary[]): void {
    this.machines = structuredClone(machines)
    this.emit(this.state())
  }
  updatePorts(ports: readonly Extract<MakerTarget, { kind: 'serial' }>[]): void {
    this.ports = structuredClone(ports)
  }
  openPreview(preview: MakerPreview): Promise<void> {
    if (this.listeners.size === 0) throw new Error(UI_TEXT.makerPreviewTitle)
    this.emit({ v: 1, type: 'makerPreview', preview })
    return Promise.resolve()
  }
}
