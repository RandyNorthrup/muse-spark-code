// D83.3/D83.16 (RLF-DEVICES): the exact-payload approval engine. It
// mints each request (an id, the payload's SHA-256, the target's
// identity, the calling authority's expiry) and accepts only an answer
// that echoes the id and digest before the expiry. One answer settles a
// request: a stale, mismatched or replayed answer is refused, and a
// verified approval is single-use. Surfaces only display.
import { createHash, randomBytes } from 'node:crypto'
import {
  makerApprovalPromptSchema,
  type MakerAnalysis,
  type MakerApprovalAnswer,
  type MakerApprovalPrompt,
  type MakerOperation,
  type MakerPreviewLine,
  type MakerTarget,
  type MakerWarning,
} from '../../shared/maker'
import type { DeviceLocalAction, DevicePresencePort } from '../devices/actionGrants'
import type { DEVICE_STEP_UP_METHODS } from '../../shared/devices'
import type { MakerAnalysisOutcome } from './analysis'
import { DEVICE_LIMITS } from '../../shared/constants'

const BYTE_TAB = 0x09
const BYTE_LINE_FEED = 0x0a
const BYTE_CARRIAGE_RETURN = 0x0d
const BYTE_PRINTABLE_MIN = 0x20
const BYTE_PRINTABLE_MAX = 0x7e

/** SHA-256 over the exact bytes; the empty payload has the empty digest. */
export function makerPayloadDigest(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex')
}

function isPrintableLine(line: Uint8Array): boolean {
  return line.every(
    (byte) => byte === BYTE_TAB || (byte >= BYTE_PRINTABLE_MIN && byte <= BYTE_PRINTABLE_MAX),
  )
}

/**
Renders every byte for the person's eye: printable lines as text,
anything else as hex (D83.3). No truncation: what is not shown cannot
be approved, and D121 keeps no count of ours.
*/
export function renderMakerPreview(payload: Uint8Array): MakerPreviewLine[] {
  if (payload.byteLength === 0) return []
  const lines: MakerPreviewLine[] = []
  let start = 0
  const push = (end: number): void => {
    const raw = payload.subarray(start, end)
    const line = raw.at(-1) === BYTE_CARRIAGE_RETURN ? raw.subarray(0, -1) : raw
    lines.push(
      isPrintableLine(line)
        ? { kind: 'text', text: Buffer.from(line).toString('utf8') }
        : { kind: 'hex', hex: Buffer.from(line).toString('hex') },
    )
  }
  for (let index = 0; index < payload.byteLength; index += 1) {
    if (payload[index] !== BYTE_LINE_FEED) continue
    push(index)
    start = index + 1
  }
  // A trailing newline terminates the last line; it is not another line.
  // The digest beside the preview still binds the exact bytes.
  if (start < payload.byteLength) push(payload.byteLength)
  return lines
}

export interface MakerMintInput {
  readonly target: MakerTarget
  readonly operation: MakerOperation
  readonly payload: Uint8Array
  readonly analysis?: MakerAnalysis
  readonly warning?: MakerWarning
  /** Opaque machine state at mint; the executor re-reads it before send. */
  readonly stateAtMint: string
  /** The calling authority's own deadline, never a maker duration (D121). */
  readonly expiresAt?: number
}

export interface MakerVerifiedApproval {
  readonly requestId: string
  readonly digest: string
  readonly target: MakerTarget
  readonly operation: MakerOperation
  readonly stateAtMint: string
  readonly verifiedAt: number
  /** The analysis the person saw with the bytes, when the mint showed one. */
  readonly analysis?: MakerAnalysis
}

export type MakerAnswerVerdict =
  | { readonly ok: true; readonly approval: MakerVerifiedApproval }
  | { readonly ok: false; readonly reason: 'approval-rejected' | 'approval-expired' }

/**
One minted request. The first answer settles it: anything but an exact
id-and-digest echo before the expiry refuses it, and a verified
approval cannot be verified twice.
*/
export class MakerPendingApproval {
  private isSettled = false
  public constructor(
    public readonly prompt: MakerApprovalPrompt,
    private readonly stateAtMint: string,
    private readonly now: () => number,
  ) {}

  public answer(input: MakerApprovalAnswer | null): MakerAnswerVerdict {
    if (this.isSettled) return { ok: false, reason: 'approval-rejected' }
    this.isSettled = true
    if (input === null) return { ok: false, reason: 'approval-rejected' }
    if (input.decision !== 'send') return { ok: false, reason: 'approval-rejected' }
    if (input.requestId !== this.prompt.requestId || input.digest !== this.prompt.digest)
      return { ok: false, reason: 'approval-rejected' }
    const at = this.now()
    if (this.prompt.expiresAt !== undefined && at >= this.prompt.expiresAt)
      return { ok: false, reason: 'approval-expired' }
    return {
      ok: true,
      approval: Object.freeze({
        requestId: this.prompt.requestId,
        digest: this.prompt.digest,
        target: this.prompt.target,
        operation: this.prompt.operation,
        stateAtMint: this.stateAtMint,
        verifiedAt: at,
        ...(this.prompt.analysis !== undefined && { analysis: this.prompt.analysis }),
      }),
    }
  }
}

export interface MakerApprovalDeps {
  readonly randomId?: () => string
  readonly now?: () => number
}

function defaultRandomId(): string {
  return randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex')
}

/** Mints approval requests; verification lives on each request. */
export class MakerApprovals {
  private readonly randomId: () => string
  private readonly now: () => number
  public constructor(deps: MakerApprovalDeps = {}) {
    this.randomId = deps.randomId ?? defaultRandomId
    this.now = deps.now ?? Date.now
  }

  public mint(input: MakerMintInput): MakerPendingApproval {
    const prompt = makerApprovalPromptSchema.parse({
      requestId: this.randomId(),
      digest: makerPayloadDigest(input.payload),
      target: input.target,
      operation: input.operation,
      preview: renderMakerPreview(input.payload),
      ...(input.analysis !== undefined && { analysis: input.analysis }),
      ...(input.warning !== undefined && { warning: input.warning }),
      ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
    })
    return new MakerPendingApproval(prompt, input.stateAtMint, this.now)
  }
}

/**
The host side of the approval: shows the prompt on the person's
surface and resolves their answer. `null` is reject (closed, aborted,
unanswered). Implemented by the panel surface and the ACP surface.
*/
export type MakerApprovalAsker = (
  prompt: MakerApprovalPrompt,
  signal: AbortSignal,
) => Promise<MakerApprovalAnswer | null>

/**
One gesture through a surface: mint, ask, verify. Used by the local
executor path; the paired path reaches the same engine through the
presence port below.
*/
export async function requestMakerApproval(
  approvals: MakerApprovals,
  asker: MakerApprovalAsker,
  input: MakerMintInput,
  signal: AbortSignal,
): Promise<MakerAnswerVerdict> {
  if (signal.aborted) return { ok: false, reason: 'approval-rejected' }
  const pending = approvals.mint(input)
  return pending.answer(await asker(pending.prompt, signal))
}

export interface MakerPresenceBindings {
  /** The target this action drives; the receiver's tool registry owns it. */
  readonly target: MakerTarget
  /** Fresh machine state, read when the prompt opens (D83.3). */
  readonly readState: () => string
  /**
  Exact analysis for an actuation payload, from the executor's reader.
  Actuation prompts only with a bound analysis: without one the grant
  refuses as presence-unverified instead of asking blind (D83.3).
  */
  readonly analyze?: (payload: Uint8Array) => MakerAnalysisOutcome | undefined
  /** The granting authority's own deadline for the held approval. */
  readonly expiresAt?: number
}

/**
Adapts the grant step-up prompt to the exact-payload engine: the person
answers one dialog carrying the target, the exact bytes, the analysis
and the warning, and the verified approval is held for the executor by
the grant's action digest. The dialog is the presence mechanism for
physical actions; the grant's biometric method selects nothing further.
A held approval is taken once; entries are pruned when their
caller-supplied expiry passes or when taken.
*/
export class MakerPresencePort implements DevicePresencePort {
  private readonly held = new Map<string, { approval: MakerVerifiedApproval; expiresAt?: number }>()
  public constructor(
    private readonly approvals: MakerApprovals,
    private readonly asker: MakerApprovalAsker,
    private readonly bindings: MakerPresenceBindings,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(): void {
    const at = this.now()
    for (const [digest, entry] of this.held) {
      if (entry.expiresAt !== undefined && at >= entry.expiresAt) this.held.delete(digest)
    }
  }

  public async confirm(input: {
    readonly actionDigest: string
    readonly action: DeviceLocalAction
    readonly method: (typeof DEVICE_STEP_UP_METHODS)[number]
    readonly signal: AbortSignal
  }): Promise<boolean> {
    this.prune()
    const operation = input.action.operation
    if (operation !== 'connect' && operation !== 'program' && operation !== 'actuate') return false
    const analysed =
      operation === 'actuate' ? this.bindings.analyze?.(input.action.payload) : undefined
    if (operation === 'actuate' && !analysed?.ok) return false
    const analysis = analysed?.ok ? analysed.analysis : undefined
    const verdict = await requestMakerApproval(
      this.approvals,
      this.asker,
      {
        target: this.bindings.target,
        operation,
        payload: input.action.payload,
        ...(analysis !== undefined && { analysis }),
        ...(operation === 'connect' && { warning: 'portReset' as const }),
        stateAtMint: this.bindings.readState(),
        ...(this.bindings.expiresAt !== undefined && { expiresAt: this.bindings.expiresAt }),
      },
      input.signal,
    )
    if (!verdict.ok) return false
    this.held.set(input.actionDigest, {
      approval: verdict.approval,
      ...(this.bindings.expiresAt !== undefined && { expiresAt: this.bindings.expiresAt }),
    })
    return true
  }

  /** The executor takes the gesture's approval once, by action digest. */
  public takeApproval(actionDigest: string): MakerVerifiedApproval | undefined {
    this.prune()
    const entry = this.held.get(actionDigest)
    if (entry === undefined) return undefined
    this.held.delete(actionDigest)
    return entry.approval
  }
}
