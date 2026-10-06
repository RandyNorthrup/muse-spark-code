import type { ReferenceText } from '../featureCatalog'
import type { featureCatalog } from '../featureCatalog'

export interface ReferenceCommand {
  readonly id: string
  readonly name: string
  readonly nameKey?: string | undefined
  readonly category: string
  readonly categoryKey?: string | undefined
  readonly description: string
  readonly text: ReferenceText
  readonly enablement?: string | undefined
  readonly canRun: boolean
}

export interface ReferenceSetting {
  readonly id: string
  readonly name: string
  readonly nameKey?: string | undefined
  readonly description: string
  readonly descriptionKey?: string | undefined
  readonly type: string | readonly string[]
  readonly default: unknown
  readonly enum?: readonly unknown[] | undefined
  readonly enumDescriptions?: readonly string[] | undefined
  readonly enumDescriptionKeys?: readonly (string | null)[] | undefined
  readonly refinements: readonly string[]
  readonly schema: Readonly<Record<string, unknown>>
  readonly scope: string
}

export interface ReferenceModel {
  readonly executable: string
  readonly features: ReturnType<typeof featureCatalog>
  readonly commands: readonly ReferenceCommand[]
  readonly settings: readonly ReferenceSetting[]
  readonly slash: readonly {
    readonly name: string
    readonly description: string
    readonly descriptions: Readonly<Record<string, ReferenceText>>
    readonly backends: readonly string[]
    readonly syntax: readonly string[]
  }[]
  readonly cli: readonly {
    readonly text?: ReferenceText | undefined
    readonly usageKey?: 'acpUsage' | 'reportUsage' | undefined
    readonly usageLine?: number | undefined
    readonly contract?: Readonly<Record<string, unknown>> | undefined
    readonly route: string
    readonly name: string
    readonly description: string
  }[]
  readonly shortcuts: readonly {
    readonly text?: ReferenceText | undefined
    readonly command: string
    readonly key: string
    readonly mac?: string | undefined
    readonly win?: string | undefined
    readonly linux?: string | undefined
    readonly when?: string | undefined
  }[]
}
