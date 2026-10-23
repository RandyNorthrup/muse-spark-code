/** Browser-safe view of the existing PlanStore summary; it never imports filesystem code. */
export interface PresentationPlan {
  readonly fileName: string
  readonly relativePath: string
  readonly title: string
}
