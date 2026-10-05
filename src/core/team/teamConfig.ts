import * as z from 'zod/mini'
import { TEAM_WRITE_SET_MAX } from '../../shared/constants'
import { teamSharedFileSchema } from '../../shared/team'

// Lane C owns only this team.json key. The M96 config reader composes this
// shape into its strict boundary schema; no parallel whole-config loader.
export const teamSharedFilesConfigShape = {
  sharedFiles: z.optional(z.array(teamSharedFileSchema).check(z.maxLength(TEAM_WRITE_SET_MAX))),
}
