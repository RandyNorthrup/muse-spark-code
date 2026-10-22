// Compact proxies for the optional U1 contract in production browser builds.
// A proxy refuses until the genuine strict schemas have loaded. Source/dev
// and every Node host continue to use the canonical contract directly.
import * as z from 'zod/mini'
import type { TeamPanelSlice, TeamPanelMessage } from '../../shared/teamPanelDefinition'
import type { TeamTreeData } from '../../shared/teamView'
import type * as TeamSchemas from '../../shared/teamPanelDefinition'

type Schemas = typeof TeamSchemas
const cache: { schemas?: Schemas | undefined; loading?: Promise<Schemas> | undefined } = {}
export const teamTemplateSchema = z.enum(['solo', 'pair', 'full', 'custom'])
export const teamPreviewSampleSchema = z.enum([
  'feature-tests',
  'research-library',
  'review-branch',
])
export const teamPanelSliceSchema = z.custom<TeamPanelSlice>(
  (value) => cache.schemas?.teamPanelSliceSchema.safeParse(value).success === true,
)
export const teamAgentsSliceSchema = z.custom<{ tree?: TeamTreeData | undefined }>(
  (value) => cache.schemas?.teamAgentsSliceSchema.safeParse(value).success === true,
)
export const teamPanelMessageSchema = z.custom<TeamPanelMessage>(
  (value) => cache.schemas?.teamPanelMessageSchema.safeParse(value).success === true,
)

function hasTeamPayload(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('state' in value)) return false
  const state = value.state
  return (
    typeof state === 'object' &&
    state !== null &&
    (('roles' in state && state.roles !== undefined) ||
      ('agents' in state && state.agents !== undefined))
  )
}
/** No load for ordinary provider/model states or navigation; retry after a failed import. */
export async function loadTeamPanelSchemas(value: unknown): Promise<void> {
  if (cache.schemas !== undefined || !hasTeamPayload(value)) return
  cache.loading ??= import('../../shared/teamPanelDefinition')
  try {
    cache.schemas = await cache.loading
  } finally {
    cache.loading = undefined
  }
}
