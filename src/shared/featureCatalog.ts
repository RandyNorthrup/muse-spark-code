import type { UiText } from './l10n/en'

// This base predates the shared Help catalogue. The reference generator reads
// this maker entry; integration must retain it beside the other feature rows.
export const FEATURE_CATALOG: readonly {
  readonly id: string
  readonly titleKey: keyof UiText
  readonly helpPath: string
}[] = [
  {
    id: 'maker-payload-review',
    titleKey: 'makerApprovalTitle',
    helpPath: 'docs/help/maker-payload-review.md',
  },
]
