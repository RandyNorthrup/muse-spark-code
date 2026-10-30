// M115w WS: the guards. Issue text is untrusted data: it is fenced
// before it reaches any prompt, and anything in it that reads as an
// instruction to the watchdog is named, never obeyed. Spam never posts:
// the hold is structural — a spam verdict closes the record without a
// post and leaves the GitHub issue open — and the triage verdict comes
// from the model, never from a threshold of ours. Posts beyond the
// acknowledgement pass the repository's approval gate.
import { fenced } from '../export/transcriptMarkdown'
import { UI_TEXT } from '../../shared/l10n/text'
import type { WatchdogPolicy } from '../../shared/watchdog'

/** Issue text as one fenced block for a prompt, title first. */
export function fenceIssueText(title: string, body: string): string {
  return fenced(`# ${title}\n\n${body}`, 'markdown')
}

const INSTRUCTION_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'label', pattern: /\blabel\s+this\b/i },
  { name: 'close', pattern: /\bclose\s+this\b/i },
  { name: 'collaborator', pattern: /\badd\s+me\s+as\s+(?:a\s+)?collaborator\b/i },
  { name: 'run', pattern: /\brun\s+[`'"]?\S*(?:curl|wget|sh|bash|powershell|cmd)\b/i },
  { name: 'token', pattern: /\bprint\s+(?:your|the)\s+token\b/i },
  { name: 'ignore', pattern: /\bignore\s+(?:all\s+|your\s+|previous\s+)*instructions\b/i },
]

/** The instruction patterns the text trips, each by name. Empty is clean. */
export function findEmbeddedInstructions(text: string): readonly string[] {
  return INSTRUCTION_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.name)
}

export type PostApproval =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

/** The repository's gate for posts beyond the acknowledgement. `ask`
puts the question to the person in the host's own way; headless hosts
refuse. */
export async function resolvePostApproval(
  policy: WatchdogPolicy,
  isPostApproved: () => Promise<boolean>,
): Promise<PostApproval> {
  if (policy.postsBeyondAck === 'always') return { allowed: true }
  if (policy.postsBeyondAck === 'never')
    return { allowed: false, reason: UI_TEXT.watchdog.refusal.approvalRequired }
  return (await isPostApproved())
    ? { allowed: true }
    : { allowed: false, reason: UI_TEXT.watchdog.refusal.approvalRequired }
}
