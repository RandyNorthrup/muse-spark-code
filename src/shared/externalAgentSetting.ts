// One `museSpark.teamExternalAgents` entry, as the person wrote it
// (PLAN.md D250). A leaf on purpose: the settings reader and the team
// offers both parse it, and neither may drag the team schema graph into
// its bundle for six fields.

import * as z from 'zod/mini'

/** Who pays for an agent, the team vocabulary (`shared/team.ts`). */
export const externalAgentPays = ['key', 'subscription', 'local'] as const

export const teamExternalAgentSettingSchema = z.object({
  name: z.string().check(z.minLength(1)),
  command: z.string().check(z.minLength(1)),
  args: z.optional(z.array(z.string())),
  model: z.optional(z.string().check(z.minLength(1))),
  pays: z.optional(z.enum(externalAgentPays)),
})
export type TeamExternalAgentSetting = z.infer<typeof teamExternalAgentSettingSchema>
