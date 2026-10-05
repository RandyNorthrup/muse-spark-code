import {
  calibrationFailure,
  calibrationPartitions,
  parseCalibrationDataset,
  type CalibrationFailure,
  type CalibrationLimits,
  type CalibrationProfile,
  type CalibrationSample,
} from './schema'

function logit(probability: number, epsilon: number): number {
  const bounded = Math.min(1 - epsilon, Math.max(epsilon, probability))
  return Math.log(bounded) - Math.log1p(-bounded)
}

function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value))
  const exponential = Math.exp(value)
  return exponential / (1 + exponential)
}

/** Offline transform only: this does not confer a calibrated runtime label. */
export function calibrationProbability(profile: CalibrationProfile, probability: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('invalid-probability')
  }
  if (profile.fit.method === 'platt') {
    return sigmoid(profile.fit.slope * logit(probability, profile.epsilon) + profile.fit.intercept)
  }
  let value = profile.fit.knots[0]?.calibratedProbability
  if (value === undefined) throw new RangeError('invalid-profile')
  for (const knot of profile.fit.knots) {
    if (knot.probability > probability) break
    value = knot.calibratedProbability
  }
  return value
}

function fitPlatt(
  rows: readonly CalibrationSample[],
  limits: CalibrationLimits,
): CalibrationProfile['fit'] | undefined {
  const features = rows.map((row) => ({
    x: logit(row.probability, limits.probabilityEpsilon),
    y: row.label,
  }))
  let slope = 1
  let intercept = 0
  // Ridge about the identity transform keeps separated data finite. Average
  // loss makes regularization independent of the number of fit examples.
  const loss = (a: number, b: number): number => {
    let total = 0
    for (const { x, y } of features) {
      const value = a * x + b
      total += Math.max(value, 0) - y * value + Math.log1p(Math.exp(-Math.abs(value)))
    }
    return total / rows.length + (limits.regularization * ((a - 1) ** 2 + b ** 2)) / 2
  }
  const canTakeStep = (stepA: number, stepB: number): boolean => {
    const previousLoss = loss(slope, intercept)
    let scale = 1
    for (let search = 0; search < limits.maxIterations; search += 1) {
      const candidateA = slope - scale * stepA
      const candidateB = intercept - scale * stepB
      if (
        Number.isFinite(candidateA) &&
        Number.isFinite(candidateB) &&
        loss(candidateA, candidateB) <= previousLoss
      ) {
        slope = candidateA
        intercept = candidateB
        return true
      }
      scale /= 2
    }
    return false
  }
  for (let iteration = 0; iteration < limits.maxIterations; iteration += 1) {
    let gradientA = limits.regularization * (slope - 1)
    let gradientB = limits.regularization * intercept
    let hessianAA = limits.regularization
    let hessianAB = 0
    let hessianBB = limits.regularization
    for (const { x, y } of features) {
      const p = sigmoid(slope * x + intercept)
      const error = (p - y) / rows.length
      const curvature = (p * (1 - p)) / rows.length
      gradientA += error * x
      gradientB += error
      hessianAA += curvature * x * x
      hessianAB += curvature * x
      hessianBB += curvature
    }
    if (Math.max(Math.abs(gradientA), Math.abs(gradientB)) <= limits.convergenceTolerance) {
      return { method: 'platt', slope, intercept }
    }
    const determinant = hessianAA * hessianBB - hessianAB * hessianAB
    if (!Number.isFinite(determinant) || determinant <= 0) return undefined
    const stepA = (hessianBB * gradientA - hessianAB * gradientB) / determinant
    const stepB = (hessianAA * gradientB - hessianAB * gradientA) / determinant
    if (!canTakeStep(stepA, stepB)) return undefined
  }
  return undefined
}

/** Pool adjacent violators; equal input probabilities share one block. */
function fitIsotonic(rows: readonly CalibrationSample[]): CalibrationProfile['fit'] {
  const grouped = new Map<number, { sum: number; count: number }>()
  for (const row of rows) {
    const group = grouped.get(row.probability) ?? { sum: 0, count: 0 }
    group.sum += row.label
    group.count += 1
    grouped.set(row.probability, group)
  }
  const blocks: { probability: number; sum: number; count: number }[] = []
  const pool = (): void => {
    while (blocks.length > 1) {
      const right = blocks.at(-1)
      const left = blocks.at(-1 - 1)
      if (
        right === undefined ||
        left === undefined ||
        left.sum / left.count <= right.sum / right.count
      )
        return
      left.sum += right.sum
      left.count += right.count
      blocks.pop()
    }
  }
  const sortedGroups = [...grouped].toSorted(([a], [b]) => a - b)
  for (const [probability, group] of sortedGroups) {
    blocks.push({ probability, ...group })
    pool()
  }
  return {
    method: 'isotonic',
    knots: blocks.map((block) => ({
      probability: block.probability,
      calibratedProbability: block.sum / block.count,
    })),
  }
}

export function fitCalibration(
  input: unknown,
  method: 'platt' | 'isotonic',
  limits: CalibrationLimits,
): CalibrationFailure | { readonly status: 'fitted'; readonly profile: CalibrationProfile } {
  const parsed = parseCalibrationDataset(input, limits)
  if (parsed.status !== 'valid') return parsed
  const { dataset } = parsed
  const rows = dataset.samples.filter((row) => row.split === 'fit')
  if (
    new Set(rows.map((row) => row.label)).size < 2 ||
    new Set(rows.map((row) => row.probability)).size < 2
  ) {
    return calibrationFailure('degenerate-dataset')
  }
  if (method === 'isotonic' && rows.length < limits.isotonicMinimumLabels) {
    return calibrationFailure('insufficient-isotonic-labels')
  }
  const fit = method === 'platt' ? fitPlatt(rows, limits) : fitIsotonic(rows)
  if (fit === undefined) return calibrationFailure('fit-did-not-converge')
  const profile: CalibrationProfile = {
    version: 1,
    identity: dataset.identity,
    evidence: dataset.evidence,
    epsilon: limits.probabilityEpsilon,
    fit,
    combinationWeight: 1,
    partitions: calibrationPartitions(dataset.samples),
  }
  // Reliability weight for 2a is learned from tuning, never evaluation.
  const tuning = dataset.samples.filter((row) => row.split === 'tuning')
  const tuningBrier =
    tuning.reduce(
      (sum, row) => sum + (calibrationProbability(profile, row.probability) - row.label) ** 2,
      0,
    ) / tuning.length
  profile.combinationWeight = 1 / Math.max(limits.weightFloor, tuningBrier)
  return { status: 'fitted', profile }
}
