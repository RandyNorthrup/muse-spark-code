/** Ordinary choices on an extension-owned card, never a guessed MSP parser field. */
export const JUDGE_CARD_CHOICES = [
  { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
  { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
] as const
