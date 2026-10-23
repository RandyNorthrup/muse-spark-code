// Approval forwarding with per-action binding (M110a F1, PLAN.md D90.10, on
// D89.7 and D83.16): a node with nobody at it mints each approval request
// (id, the exact action's digest, expiry) and accepts only an answer that
// echoes them, signed in the forwarding pair's channel. The ask shows on
// the orchestrator's surfaces and names the node, workspace and task. Paid
// consent stays priced and bound on the node that pays; a forwarded Bypass
// is never accepted; each grant is revocable and audited. Channel
// authentication (the signature) is the delivery port's; this verifies the
// binding inside an authenticated channel, and the desk below makes the
// secure path the only path: one answer per request, replays refused,
// expiry on a monotonic clock. Pure.

import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'

const digestSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/))

/** The price binding a forwarded paid ask carries; the payer's gate checks it. */
export const forwardPriceSchema = z.strictObject({
  feature: z.string().check(z.minLength(1)),
  usdEstimate: z.string().check(z.minLength(1)),
})
export type ForwardPrice = z.infer<typeof forwardPriceSchema>

/** One approval ask, minted on the node that needs the answer. */
export const forwardRequestSchema = z.strictObject({
  requestId: z.string().check(z.minLength(1)),
  actionDigest: digestSchema,
  /** Monotonic expiry on the minting node's clock. */
  expiresAtMono: z.number().check(z.gte(0)),
  /** Display-only: what the orchestrator's surfaces show. Never trusted. */
  nodeName: z.string().check(z.minLength(1)),
  workspaceName: z.string().check(z.minLength(1)),
  taskName: z.string().check(z.minLength(1)),
  actionSummary: z.string().check(z.minLength(1)),
  paid: z.optional(forwardPriceSchema),
})
export type ForwardRequest = z.infer<typeof forwardRequestSchema>

/** The surface's answer: it echoes the binding, never widens it. */
export const forwardAnswerSchema = z.strictObject({
  requestId: z.string().check(z.minLength(1)),
  actionDigest: digestSchema,
  decision: z.enum(['allow', 'deny']),
  asBypass: z.boolean(),
})
export type ForwardAnswer = z.infer<typeof forwardAnswerSchema>

/**
Mint one ask: the id, the digest of the exact action, and the expiry the
caller chose (the ask's own lifetime, not a limit of ours). The caller
supplies the display names the surfaces show.
*/
export function mintForwardRequest(options: {
  readonly actionDigest: string
  readonly nowMono: number
  readonly ttlMs: number
  readonly nodeName: string
  readonly workspaceName: string
  readonly taskName: string
  readonly actionSummary: string
  readonly paid?: ForwardPrice
}): ForwardRequest {
  return forwardRequestSchema.parse({
    requestId: randomUUID(),
    actionDigest: options.actionDigest,
    expiresAtMono: options.nowMono + options.ttlMs,
    nodeName: options.nodeName,
    workspaceName: options.workspaceName,
    taskName: options.taskName,
    actionSummary: options.actionSummary,
    paid: options.paid,
  })
}

/** What answering one ask says: the decision, or why the answer is refused. */
export type ForwardVerdict =
  | { readonly verdict: 'accept'; readonly decision: 'allow' | 'deny' }
  | { readonly verdict: 'mismatch' | 'expired' | 'replay' | 'bypass-refused' }

/**
Answer one ask against its request: the answer must echo the request's id
and digest, arrive before expiry, be the request's first answer, and never
be an allow as Bypass. A deny is an accepted answer that denies. The
caller journals the verdict with the request; `answered` is the desk's
replay record.
*/
export function answerForward(
  request: ForwardRequest,
  answer: ForwardAnswer,
  nowMono: number,
  answered: ReadonlySet<string>,
): ForwardVerdict {
  if (answer.requestId !== request.requestId || answer.actionDigest !== request.actionDigest)
    return { verdict: 'mismatch' }
  if (nowMono >= request.expiresAtMono) return { verdict: 'expired' }
  if (answered.has(request.requestId)) return { verdict: 'replay' }
  return answer.decision === 'allow' && answer.asBypass
    ? { verdict: 'bypass-refused' }
    : { verdict: 'accept', decision: answer.decision }
}

/**
The worker's side of the forwarding pair: it holds the asks it minted,
answers each at most once, and drops the expired. Delivery to and from
the orchestrator's surfaces is M100's channel; this desk never sends.
*/
export class ForwardingDesk {
  private readonly pending = new Map<string, ForwardRequest>()
  private readonly answered = new Set<string>()

  /** File an ask the node minted; a duplicate id is a caller bug. */
  ask(request: ForwardRequest): void {
    if (this.pending.has(request.requestId) || this.answered.has(request.requestId))
      throw new Error(`duplicate forward request ${request.requestId}`)
    this.pending.set(request.requestId, request)
  }

  /**
  Answer a filed ask: an answer for no filed ask is a mismatch, and a
  filed ask answers once. The verdict carries the decision for the
  worker and the journal; paid asks carry their price binding in the
  filed request for the payer's gate.
  */
  answer(answer: ForwardAnswer, nowMono: number): ForwardVerdict {
    if (this.answered.has(answer.requestId)) return { verdict: 'replay' }
    const request = this.pending.get(answer.requestId)
    if (request === undefined) return { verdict: 'mismatch' }
    const verdict = answerForward(request, answer, nowMono, this.answered)
    if (verdict.verdict === 'accept') {
      this.pending.delete(request.requestId)
      this.answered.add(request.requestId)
    }
    return verdict
  }

  /** Drop filed asks past their expiry; returns how many went. */
  prune(nowMono: number): number {
    let dropped = 0
    for (const [requestId, request] of this.pending) {
      if (!(nowMono >= request.expiresAtMono)) {
        continue
      }

      this.pending.delete(requestId)
      dropped += 1
    }
    return dropped
  }

  /** How many asks wait for an answer. */
  get pendingCount(): number {
    return this.pending.size
  }
}
