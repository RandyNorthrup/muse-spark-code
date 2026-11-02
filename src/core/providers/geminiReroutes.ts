// Gemini ids Google serves with another model (PROV-HONEST): each row is a
// dated provider-page citation, never a guess from the id. Requests to a
// rerouted id are billed at the serving model's rates, so the registry
// prices and labels the id as the model that serves it once the reroute
// is effective on the catalogue's own date. `scripts/sync-provider-catalog.mjs`
// re-checks every row on each sync (both ids still listed, the serving
// model still priced) and fails loudly when one goes stale.
import * as z from 'zod/mini'
import type { NativeModelMetadata } from './modelMetadata'
import rows from './geminiReroutes.json'

const rerouteSchema = z.object({
  /** The configured native id Google reroutes. */
  id: z.string().check(z.minLength(1)),
  /** The native id that serves it (and bills for it). */
  serves: z.string().check(z.minLength(1)),
  /** The first day the reroute serves (`YYYY-MM-DD`); null means already serving. */
  from: z.nullable(z.string()),
  /** The provider page that states the reroute. */
  docUrl: z.string().check(z.minLength(1)),
  /** The day the page was read, `YYYY-MM-DD`. */
  readOn: z.string().check(z.minLength(1)),
})
export type GeminiReroute = z.infer<typeof rerouteSchema>

const tableSchema = z.array(rerouteSchema).check(
  z.refine((table) => {
    const ids = table.map((row) => row.id)
    return new Set(ids).size === ids.length
  }),
)

/** The cited reroute table, one row per rerouted id. */
export const GEMINI_REROUTES: readonly GeminiReroute[] = tableSchema.parse(rows)

/**
The reroute for a native Gemini id on the catalogue's date, if Google
reroutes it. `active` is true once the catalogue's own `fetchedAt`
reaches the row's first day (a row without one already serves); without
a catalogue date only already-serving rows are active. The picker names
the serving model either way; pricing and labels follow only an active
reroute.
*/
export function resolveGeminiReroute(
  nativeModel: string,
  fetchedAt: string | undefined,
): { readonly serves: string; readonly active: boolean; readonly from: string | null } | undefined {
  const row = GEMINI_REROUTES.find((candidate) => candidate.id === nativeModel)
  if (row === undefined) return undefined
  return row.from === null || (fetchedAt !== undefined && fetchedAt >= row.from)
    ? { serves: row.serves, active: true, from: row.from }
    : { serves: row.serves, active: false, from: row.from }
}

/** A Gemini id Google serves with another model, as rows carry it. */
export interface ModelReroute {
  /** The serving native id. */
  readonly serves: string
  /** The serving model's display name (its id where the catalogue names none). */
  readonly servesLabel: string
  /** True once the reroute serves on the catalogue's date. */
  readonly active: boolean
  /** The first serving day (`YYYY-MM-DD`), set while the reroute is future. */
  readonly from?: string | undefined
}

/**
One catalogue id under the reroute table: the row to evidence, price
and label from, and the reroute to name. An active reroute answers the
serving row (absent where the snapshot does not carry it, and the
caller falls back to the requested row); a future one answers no row,
so pricing and labels stay on the model that serves today. The reroute
itself rides along either way, so the picker names it.
*/
export function applyGeminiReroute(
  models: Readonly<Record<string, NativeModelMetadata>> | undefined,
  nativeModel: string,
  fetchedAt: string | undefined,
): { readonly row: NativeModelMetadata | undefined; readonly reroute: ModelReroute | undefined } {
  const resolved = resolveGeminiReroute(nativeModel, fetchedAt)
  if (resolved === undefined) return { row: undefined, reroute: undefined }
  const serving = models?.[resolved.serves]
  const name = serving?.['name']
  return {
    row: resolved.active ? serving : undefined,
    reroute: {
      serves: resolved.serves,
      servesLabel: typeof name === 'string' ? name : resolved.serves,
      active: resolved.active,
      ...(!resolved.active && resolved.from !== null && { from: resolved.from }),
    },
  }
}
