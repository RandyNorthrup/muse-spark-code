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
  readonly scope: string
}

export interface ReferenceModel {
  readonly features: ReturnType<typeof featureCatalog>
  readonly commands: readonly ReferenceCommand[]
  readonly settings: readonly ReferenceSetting[]
  readonly slash: readonly {
    readonly name: string
    readonly description: string
    readonly descriptions: Readonly<Record<string, ReferenceText>>
    readonly backends: readonly string[]
  }[]
  readonly cli: readonly {
    readonly route: string
    readonly name: string
    readonly description: string
  }[]
  readonly shortcuts: readonly {
    readonly command: string
    readonly key: string
    readonly mac?: string | undefined
    readonly win?: string | undefined
    readonly linux?: string | undefined
    readonly when?: string | undefined
  }[]
}
