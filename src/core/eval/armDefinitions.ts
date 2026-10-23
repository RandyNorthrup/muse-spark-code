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
    // D107 (M125 lane V): the judge arms. Each isolates one fast decision
    // — that decision runs its natural verdict, every other pins off —
    // against the all-off baseline. Keep's pair carries evaluated
    // compaction (the M101 options), since keep only fires at one; the
    // compaction baseline keeps the pair to the one difference.
    case 'judge-off': {
      return { name, fastIsolated: 'none' }
    }
    case 'judge-pack-off': {
      return { name, fastIsolated: 'none', observationPacking: true }
    }
    case 'judge-keep-off': {
      return {
        name,
        fastIsolated: 'none',
        autoCompaction: true,
        autoCompactionEvaluated: true,
        evaluationAdmission: true,
      }
    }
    case 'judge-triage': {
      return { name, fastIsolated: 'triage.needFull', observationPacking: true }
    }
    case 'judge-context': {
      return {
        name,
        fastIsolated: 'context.include',
        autoCompaction: true,
        autoCompactionEvaluated: true,
        evaluationAdmission: true,
      }
    }
    case 'judge-loop': {
      return { name, fastIsolated: 'loop.stuck' }
    }
    case 'judge-effort': {
      return { name, fastIsolated: 'effort.lower' }
    }
    case 'judge-failure': {
      return { name, fastIsolated: 'failure.unmentioned' }
    }
    case 'judge-done': {
      return { name, fastIsolated: 'done.unbacked' }
    }
    default: {
      throw new Error(`unknown frozen evaluation arm: ${name}`)
    }
  }
}
