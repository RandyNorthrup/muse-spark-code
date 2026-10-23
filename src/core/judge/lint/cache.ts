import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { JudgeRequest, JudgeSource } from '../schema'

const decisionSchema = z.strictObject({
  outcome: z.enum(['pass', 'fail', 'skip', 'abstain', 'inconclusive']),
  confidence: z.number().check(z.gte(0), z.lte(1)),
})
export type LintDecision = z.infer<typeof decisionSchema>

/** Changing any source/profile/prompt binding must invalidate an earlier answer. */
export interface LintIdentity {
  readonly endpoint: string
  readonly model: string
  readonly source: JudgeSource
  readonly profile: string
  readonly criteriaVersion: string
  readonly credentialFingerprint: string
  readonly provenance: 'independent' | 'experimental-systemone'
}

function cacheKey(request: JudgeRequest, identity: LintIdentity): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request,
        identity.endpoint,
        identity.model,
        identity.source,
        identity.profile,
        identity.criteriaVersion,
        identity.credentialFingerprint,
        identity.provenance,
      ]),
    )
    .digest('hex')
}

/** Only digests and bounded decision primitives survive a call; no source, key or wire extras. */
export class LintCache {
  readonly #entries = new Map<string, readonly LintDecision[]>()

  constructor(private readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('lint-cache-invalid-capacity')
    }
  }

  get(request: JudgeRequest, identity: LintIdentity): readonly LintDecision[] | undefined {
    const decisions = this.#entries.get(cacheKey(request, identity))
    return decisions?.map((decision) => ({ ...decision }))
  }

  put(request: JudgeRequest, identity: LintIdentity, decisions: readonly LintDecision[]): void {
    const bounded = z.array(decisionSchema).parse(decisions)
    if (bounded.length !== Object.keys(request.questions).length) {
      throw new RangeError('lint-cache-answer-count')
    }
    const key = cacheKey(request, identity)
    this.#entries.delete(key)
    this.#entries.set(
      key,
      bounded.map((decision) => ({ ...decision })),
    )
    if (this.#entries.size <= this.maxEntries) return
    const oldest = this.#entries.keys().next().value
    if (oldest !== undefined) this.#entries.delete(oldest)
  }

  /** A source-free storage representation; callers must never log decision data. */
  toJSON(): readonly { readonly digest: string; readonly decisions: readonly LintDecision[] }[] {
    return [...this.#entries].map(([digest, decisions]) => ({
      digest,
      decisions: decisions.map((decision) => ({ ...decision })),
    }))
  }
}
