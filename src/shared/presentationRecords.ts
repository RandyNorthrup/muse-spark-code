/** Browser-safe view of the existing PlanStore summary; it never imports filesystem code. */
export interface PresentationPlan {
  readonly fileName: string
  readonly relativePath: string
  readonly title: string
}

/** Internal presentation records, produced from selected provider/model capabilities. */
export interface PresentationRole {
  readonly id: string
  readonly name: string
  readonly providerId: string
  readonly modelId: string
  readonly status: string
  readonly capabilities: readonly string[]
}

export interface PresentationTraffic {
  readonly id: string
  readonly sourceId: string
  readonly targetId: string
  readonly at: number
  /** Engine-sanitized summary; no credential, raw wire frame or hidden prompt. */
  readonly summary: string
}
