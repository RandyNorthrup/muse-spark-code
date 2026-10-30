// The workspace's scheduler settings (M96c, PLAN.md D75): the integration
// flow, the stall policy, the shared files and the check-slot setup, kept
// in workspace state and set in the Roles section. The Traffic and runners
// wire shapes live in modelsPanel.ts; this file owns only the settings.
import * as z from 'zod/mini'
import { TEAM_WRITE_SET_MAX } from './constants'
import {
  runnerSchema,
  teamIntegrationFlowSchema,
  teamOnStallSchema,
  teamSharedFileSchema,
} from './team'

export const TEAM_WINDOW_SETTINGS_KEY = 'museSpark.team.schedulerSettings'
export const teamWindowSettingsSchema = /* @__PURE__ */ z.strictObject({
  integrationFlow: z._default(teamIntegrationFlowSchema, 'manual'),
  onStall: z._default(teamOnStallSchema, 'ask'),
  sharedFiles: z._default(z.array(teamSharedFileSchema).check(z.maxLength(TEAM_WRITE_SET_MAX)), []),
  dependencyInstallation: z._default(z.enum(['checkSlots', 'perCopy']), 'checkSlots'),
  setupCommand: z._default(z.union([z.literal(''), runnerSchema.shape.setupCommand]), ''),
  cacheKey: z._default(z.union([z.literal(''), runnerSchema.shape.cacheKey]), ''),
})
export type TeamWindowSettings = z.infer<typeof teamWindowSettingsSchema>
