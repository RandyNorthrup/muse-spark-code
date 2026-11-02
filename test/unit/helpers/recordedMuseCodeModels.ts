// Muse Code's recorded `model/list` reading (1.4.10, recorded 2026-10-18;
// test/fixtures/muse-contributor/provenance.json) as the host's own model
// summaries, for suites that prove behaviour against the served shapes
// instead of inventing rows.
import { readFileSync } from 'node:fs'
import {
  modelListResultSchema,
  toModelSummary,
  type MuseCodeModelSummary,
} from '../../../src/core/backends/musecode/MuseCodeHost'

/** The recorded model list, parsed and mapped by the host's own code. */
export function recordedMuseCodeModels(): MuseCodeModelSummary[] {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL('../../fixtures/muse-contributor/model-list-1.4.10.json', import.meta.url),
      'utf8',
    ),
  )
  return modelListResultSchema.parse(raw).models.map((row) => toModelSummary(row))
}
