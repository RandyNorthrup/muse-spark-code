// Pure check-command fields shared by settings and maker surface presets.
import * as z from 'zod/mini'
import { CHECK_NAME_MAX_CHARS, CHECK_COMMAND_MAX_CHARS } from './constants'

export const checkCommandSchema = z.object({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(CHECK_NAME_MAX_CHARS)),
  command: z.string().check(z.trim(), z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS)),
  changedFiles: z.optional(z.boolean()),
  timeoutSeconds: z.optional(z.int().check(z.positive())),
})
