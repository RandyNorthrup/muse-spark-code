import { SLASH_COMMAND_NAMES } from '../../shared/constants'

/** Invalid arguments remain local too: a reserved command never falls through to a model. */
export function reportCommandArguments(text: string): string | undefined {
  const trimmed = text.trim()
  const command = `/${SLASH_COMMAND_NAMES.report}`
  if (trimmed === command) return ''
  return trimmed.startsWith(command) && /\s/.test(trimmed.charAt(command.length))
    ? trimmed.slice(command.length).trim()
    : undefined
}
