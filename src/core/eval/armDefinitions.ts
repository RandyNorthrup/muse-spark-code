// Pure frozen arm programs. Only the permission-limited child imports this
// module; the parent validates its JSON and applies fixed host adapters.
import { CONSERVATIVE_CAPABILITIES } from '../providers/capabilities'
import { FORMAT_QUIRKS } from '../providers/presets'

export function run(name: string): unknown {
  switch (name) {
    case 'baseline': {
      return { name }
    }
    case 'packing': {
      return { name, observationPacking: true }
    }
    case 'auto-compaction': {
      return {
        name,
        autoCompaction: true,
        autoCompactionEvaluated: true,
        evaluationAdmission: true,
      }
    }
    case 'strict-tools': {
      return {
        name,
        modelFacts: {
          capabilities: { ...CONSERVATIVE_CAPABILITIES, supportsStrictTools: true },
          quirks: { cachedUsageFields: FORMAT_QUIRKS.responses.cachedUsageFields },
        },
      }
    }
    default: {
      throw new Error(`unknown frozen evaluation arm: ${name}`)
    }
  }
}
