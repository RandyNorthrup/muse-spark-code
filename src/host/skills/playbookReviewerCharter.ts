import { PLAYBOOK_MODEL_TEXT } from '../../shared/constants'

/** What the harness knows about one module a playbook review counts in. */
export interface PlaybookCharterTarget {
  readonly moduleKey: string
  /** The module's last counted round; absent on its first review. */
  readonly prior?:
    | {
        readonly round: number
        readonly findings: readonly {
          readonly id: string
          readonly file: string
          readonly line?: number | undefined
          readonly severity: string
          readonly class?: string | undefined
        }[]
      }
    | undefined
  /** The pending design decision, on a redesign's review. */
  readonly design?: { readonly failureClass: string; readonly structuralChange: string } | undefined
}

/** Fills a line's slots; this bundle carries no display table to do it with. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replaceAll(/\{(\w+)\}/gu, (slot, name: string) => values[name] ?? slot)
}

function moduleFacts(target: PlaybookCharterTarget): string {
  const { moduleKey, prior, design } = target
  const lines = [
    fill(PLAYBOOK_MODEL_TEXT.playbookReviewModule, {
      module: moduleKey,
      round: String((prior?.round ?? 0) + 1),
    }),
  ]
  if (prior !== undefined && prior.findings.length > 0)
    lines.push(
      fill(PLAYBOOK_MODEL_TEXT.playbookReviewPrior, {
        findings: prior.findings
          .map(
            (finding) =>
              `${finding.id} (${finding.severity} ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}${finding.class === undefined ? '' : `, ${finding.class}`})`,
          )
          .join('; '),
      }),
    )
  if (design !== undefined)
    lines.push(
      fill(PLAYBOOK_MODEL_TEXT.playbookReviewRedesign, {
        failureClass: design.failureClass,
        structuralChange: design.structuralChange,
      }),
    )
  return lines.join('\n')
}

/**
Read only for a playbook review, through the existing lazy skills bundle.
With the modules the review counts in, the charter is followed by the
harness's facts about each: the ids a redesign review must resolve are
these, never ids the change or the model supplies.
*/
export function playbookReviewerCharter(targets: readonly PlaybookCharterTarget[] = []): string {
  return [
    PLAYBOOK_MODEL_TEXT.playbookReviewInstructions,
    ...targets.map((target) => moduleFacts(target)),
  ].join('\n\n')
}
