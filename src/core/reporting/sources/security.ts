// C-M113-3: the reporting `security` source from M109's vault audit and
// the developer audit. Counts, kinds, decisions and authorities only: the
// reader projects away every id, name, label, target, handle, digest, hash
// and mac before returning, so no value can reach any report output. Only
// the security kind reads this port: every other kind sees it as not
// applicable, never as empty success.
import * as z from 'zod/mini'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import type { ReportSourcePayloads, SourceReadContext } from './types'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  scrubSourceValue,
  type SourceScrub,
} from './local'

const word = z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS))
const count = z.number().check(z.int(), z.nonnegative())
const groups = <T extends z.ZodMiniType>(entry: T) =>
  z.array(entry).check(z.maxLength(REPORT_MAX_ROWS))

export const securityAuditRowSchema = z.strictObject({
  kind: word,
  decision: z.enum(['allow', 'deny', 'ask']),
  authority: word,
  outcome: word,
})

export const securityDeveloperAuditRowSchema = z.strictObject({ action: word, source: word })

const factsSchema = z.strictObject({
  vault: z.nullable(
    z.strictObject({
      state: z.enum([
        'uncreated',
        'setupPending',
        'locked',
        'unlocked',
        'unavailable',
        'firstPartyOnly',
      ]),
      tier: z.nullable(word),
      itemCount: count,
      itemsByKind: groups(
        z.strictObject({
          kind: word,
          count,
        }),
      ),
      grants: groups(
        z.strictObject({
          scope: word,
          count,
        }),
      ),
    }),
  ),
  audit: groups(securityAuditRowSchema),
  developerAudit: groups(securityDeveloperAuditRowSchema),
})

/** Vault aggregates and the developer audit for one report, never a value. */
export interface ReportSecurityReader {
  read(context: SourceReadContext): Promise<{
    facts: ReportSourcePayloads['security']
    observedAt?: string
    partial?: string
  } | null>
}

function rank(left: string, right: string): number {
  return codeUnitCompare(left, right)
}

export function securitySource(reader: ReportSecurityReader | undefined, scrub: SourceScrub) {
  return localSource('security', async (context) => {
    if (reader === undefined) throw new LocalSourceError('unbound')
    if (context.options.kind !== 'security') throw new LocalSourceError('disabled')
    const read = await reader.read(context)
    if (read === null) throw new LocalSourceError('missing')
    const facts = factsSchema.parse(scrubSourceValue(read.facts, scrub))
    return {
      data: {
        vault:
          facts.vault === null
            ? null
            : {
                ...facts.vault,
                itemsByKind: facts.vault.itemsByKind.toSorted((left, right) =>
                  rank(left.kind, right.kind),
                ),
                grants: facts.vault.grants.toSorted((left, right) => rank(left.scope, right.scope)),
              },
        audit: facts.audit.toSorted(
          (left, right) =>
            rank(left.kind, right.kind) ||
            rank(left.decision, right.decision) ||
            rank(left.authority, right.authority) ||
            rank(left.outcome, right.outcome),
        ),
        developerAudit: facts.developerAudit.toSorted(
          (left, right) => rank(left.action, right.action) || rank(left.source, right.source),
        ),
      },
      ...(read.observedAt !== undefined && { observedAt: read.observedAt }),
      ...(read.partial !== undefined && { partial: scrub(read.partial) }),
    }
  })
}
