// M115w WV: the outcome replies. Each verdict's template, filled from
// the findings the schema proved present, signed with the reply marker
// and the automated note. A reply never embeds issue text: the questions
// are the triage's own words, and the duplicate, version and pull
// request are identifiers, not prose.
import { WATCHDOG_REPLY_MARKER } from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import type { TriageFindings, WatchdogOutcome } from '../../shared/watchdog'
import { signWatchdogPost } from './ack'
import { fenceIssueText } from './guard'

export interface FixedReplyEvidence {
  readonly pullRequestNumber: number
  readonly pullRequestUrl: string
  readonly version: string
}

function required(value: string | number | undefined, what: string): string | number {
  if (value === undefined) throw new Error(`a watchdog reply needs ${what}`)
  return value
}

function outcomeBody(
  outcome: WatchdogOutcome,
  findings: TriageFindings,
  fixed?: FixedReplyEvidence,
): string {
  switch (outcome) {
    case 'needsInfo': {
      return fill(UI_TEXT.watchdog.reply.needsInfo, {
        questions: findings.questions.map((question) => `- ${question}`).join('\n'),
      })
    }
    case 'duplicate': {
      return fill(UI_TEXT.watchdog.reply.duplicate, {
        duplicate: String(required(findings.duplicateOf, 'its duplicate issue')),
      })
    }
    case 'alreadyFixed': {
      return fill(UI_TEXT.watchdog.reply.alreadyFixed, {
        fixedIn: String(required(findings.fixedIn, 'its fixed version')),
      })
    }
    case 'invalid': {
      return fill(UI_TEXT.watchdog.reply.invalid, { reason: findings.summary })
    }
    case 'spam': {
      throw new Error('a watchdog reply never answers spam')
    }
    case 'planEntry':
    case 'fixLane': {
      if (fixed === undefined) throw new Error('a watchdog reply needs its fix evidence')
      return fill(UI_TEXT.watchdog.reply.fixed, {
        pullRequest: `[#${String(fixed.pullRequestNumber)}](${fixed.pullRequestUrl})`,
        version: fixed.version,
      })
    }
  }
}

/** The signed reply for the outcome. Spam and evidence-free fixes throw. */
export function composeReplyBody(
  outcome: WatchdogOutcome,
  findings: TriageFindings,
  fixed?: FixedReplyEvidence,
): string {
  return signWatchdogPost(outcomeBody(outcome, findings, fixed), WATCHDOG_REPLY_MARKER)
}

/** The plan draft the valid outcome hands its host: the fenced issue,
the findings and the outcome, ready to save beside the person's plans. */
export function composePlanDraft(
  repository: string,
  issueNumber: number,
  title: string,
  body: string,
  findings: TriageFindings,
): string {
  const lines = [
    `# ${title}`,
    '',
    fill(UI_TEXT.watchdog.planDraft.intro, {
      repository,
      number: String(issueNumber),
      verdict: UI_TEXT.watchdog.verdicts[findings.verdict],
    }),
    '',
    `## ${UI_TEXT.watchdog.planDraft.issue}`,
    '',
    fenceIssueText(title, body),
    '',
    `## ${UI_TEXT.watchdog.planDraft.findings}`,
    '',
    findings.summary,
  ]
  if (findings.questions.length > 0) {
    lines.push(
      '',
      `## ${UI_TEXT.watchdog.planDraft.questions}`,
      '',
      ...findings.questions.map((question) => `- ${question}`),
    )
  }
  return `${lines.join('\n')}\n`
}
