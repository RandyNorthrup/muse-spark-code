/** Measured data, not a calibration profile or permission to download (M98). */
export const LOCAL_JUDGE_RECOMMENDATIONS = [
  {
    model: 'tev1:4b',
    technique: 'systemone',
    downloadBytes: 4_482_415_847,
    recommended: true,
    evidence: 'docs/certification/m98-research.md',
    requiresCalibrationForAuto: false,
  },
  {
    model: 'tev1:0.8b',
    technique: 'systemone',
    downloadBytes: 811_856_202,
    recommended: false,
    evidence: 'docs/certification/m98p2-j.md#linux-native',
    requiresCalibrationForAuto: true,
  },
  {
    model: 'qwen3:4b-instruct-2507-q4_K_M',
    technique: 'logprob',
    downloadBytes: 2_497_293_803,
    recommended: false,
    evidence: 'docs/certification/m98-2j-spike.md',
    requiresCalibrationForAuto: true,
  },
  {
    model: 'tev1:0.8b-q8_0',
    technique: 'systemone',
    downloadBytes: 811_856_202,
    recommended: false,
    evidence: 'docs/certification/m98p2-j.md',
    requiresCalibrationForAuto: true,
  },
] as const

export interface LocalModelPullAction {
  /** Supplied only by the explicit download UI/CLI action, never source resolution. */
  readonly explicitUserAction: boolean
  /** The UI must show both the exact model and this many download bytes. */
  consent(model: string, downloadBytes: number): Promise<boolean>
  /** Executes the vetted runtime's pull without credentials, through the host. */
  pull(model: string, signal: AbortSignal): Promise<void>
}

/** No automatic pulls. A refusal is explicit, and no consent survives this action. */
export async function pullLocalJudgeModel(
  model: string,
  action: LocalModelPullAction,
  signal: AbortSignal,
): Promise<'pulled' | 'consent-declined'> {
  signal.throwIfAborted()
  const isExplicit = () => action.explicitUserAction
  if (!isExplicit()) throw new Error('explicit-action-required')
  const recommendation = LOCAL_JUDGE_RECOMMENDATIONS.find((item) => item.model === model)
  if (!recommendation) throw new Error('unsupported-local-model')
  if (!(await action.consent(model, recommendation.downloadBytes))) return 'consent-declined'
  signal.throwIfAborted()
  if (!isExplicit()) throw new Error('explicit-action-required')
  await action.pull(model, signal)
  return 'pulled'
}
