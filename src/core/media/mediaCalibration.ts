// MONEY017D / D85.6: the estimator's production seed. Every point is one
// single-media turn's complete reported input (prompt included, per the
// C lane's conservative convention) from the owner-authorized captures in
// `docs/research/m105-captures/` (raw records) and
// `docs/certification/m105-captures.md` (receipts). The shape is exactly
// what MediaCostEstimator stores; the loader validates it before use, so a
// drifted table fails closed instead of mispricing a reservation.
//
// What the seeds say, and what stays refused under a cap:
// - image `detail` is ignored by both models (4,086 tokens at every level
//   for 3000x2000), so the estimate does not vary by detail;
// - on 1.2, `fps: 1` is cheaper at 120 s (10,651 vs 19,771); on 1.3,
//   `fps: 2` equals `fps: 1` (8,207). The estimator keeps separate
//   default-fps and explicit-fps variants, and the largest-rate upper bound
//   keeps a reservation above the 120-second 1.2 default bill;
// - no PDF page bill was captured, so documents stay refused under a cap;
// - Meta audio was never heard (U7) and transcription is billed by seconds,
//   not by this estimator, so audio stays refused here too;
// - images larger than 3000x2000 and fps above 2 are unmeasured, so the
//   estimator bounds them conservatively: larger images and video past 600
//   seconds refuse under a cap (the rate curve is evidenced only to there),
//   and unseeded fps values refuse through the variant match.
import * as z from 'zod/mini'
import { calibrationPointSchema, type CalibrationPoint } from './mediaCost'

const seeds: readonly CalibrationPoint[] = [
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: null },
    units: 10,
    inputTokens: 2751,
    captureId: 'm105-r1-2026-10-05-U4-1.3',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: null },
    units: 30,
    inputTokens: 8207,
    captureId: 'm105-r2-2026-10-05-R03',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: 1 },
    units: 30,
    inputTokens: 8207,
    captureId: 'm105-r2-2026-10-05-R04',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: 2 },
    units: 30,
    inputTokens: 8207,
    captureId: 'm105-r3-2026-10-08-V13f2',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: null },
    units: 120,
    inputTokens: 32_731,
    captureId: 'm105-r2-2026-10-05-O1',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: 1 },
    units: 120,
    inputTokens: 32_731,
    captureId: 'm105-r2-2026-10-05-R07',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: null },
    units: 600,
    inputTokens: 85_531,
    captureId: 'm105-r2-2026-10-05-R05',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'video', fps: 1 },
    units: 600,
    inputTokens: 85_531,
    captureId: 'm105-r2-2026-10-05-R06',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'video', fps: null },
    units: 10,
    inputTokens: 1671,
    captureId: 'm105-r1-2026-10-05-U4-1.2',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'video', fps: null },
    units: 30,
    inputTokens: 4967,
    captureId: 'm105-r2-2026-10-05-R12',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'video', fps: 1 },
    units: 30,
    inputTokens: 4967,
    captureId: 'm105-r2-2026-10-05-R13',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'video', fps: null },
    units: 120,
    inputTokens: 19_771,
    captureId: 'm105-r3-2026-10-08-V12d',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'video', fps: 1 },
    units: 120,
    inputTokens: 10_651,
    captureId: 'm105-r3-2026-10-08-V12f',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'video', fps: null },
    units: 600,
    inputTokens: 53_131,
    captureId: 'm105-r2-2026-10-05-R14',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'video', fps: 1 },
    units: 600,
    inputTokens: 53_131,
    captureId: 'm105-r2-2026-10-05-R15',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'image', detail: 'auto' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I13a',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'image', detail: 'low' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I13l',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'image', detail: 'high' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I13h',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.3-contributor',
    variant: { kind: 'image', detail: 'original' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I13o',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'image', detail: 'auto' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I12a',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'image', detail: 'low' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I12l',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'image', detail: 'high' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I12h',
    upperOnly: false,
  },
  {
    provider: 'meta',
    modelId: 'muse-spark-1.2-contributor',
    variant: { kind: 'image', detail: 'original' },
    units: 1,
    inputTokens: 4086,
    captureId: 'm105-r3-2026-10-08-I12o',
    upperOnly: false,
  },
]

/** The 23 capture points, validated against the estimator's stored shape. */
export function productionCalibrationSeeds(): CalibrationPoint[] {
  return z.array(calibrationPointSchema).parse(structuredClone(seeds))
}
