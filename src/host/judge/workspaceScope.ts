// Paid settings are machine-scoped (PLAN.md D15, D30): VS Code reads
// `museSpark.judge.engine` and `museSpark.judge.separate` from user settings
// only, so a repository's workspace settings can never turn paid use on. A
// value found only there is not honoured, and never silently either: the
// window names it (gap `scope`) in the status line and the log. This reads
// the raw workspace files (`.vscode/settings.json`, a `.code-workspace`
// file's `settings`), which VS Code itself hides for these settings.
import * as z from 'zod/mini'
import { SETTINGS_SECTION } from '../../shared/constants'

const ENGINE_KEY = `${SETTINGS_SECTION}.judge.engine`
const SEPARATE_KEY = `${SETTINGS_SECTION}.judge.separate`

/** The text with JSONC comments and trailing commas removed; strings are kept as written. */
function plainJson(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '"') {
      const start = index
      index += 1
      while (index < text.length && text.charAt(index) !== '"') {
        index += text.charAt(index) === '\\' ? 2 : 1
      }
      index += 1
      out += text.slice(start, index)
    } else if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
    } else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return out.replaceAll(/,(\s*[}\]])/g, '$1')
}

const recordSchema = z.record(z.string(), z.unknown())

function settingsOf(text: string): Readonly<Record<string, unknown>> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(plainJson(text))
  } catch {
    return undefined
  }
  const record = recordSchema.safeParse(parsed)
  if (!record.success) return undefined
  // A `.code-workspace` file keeps its settings under `settings`.
  const nested = recordSchema.safeParse(record.data['settings'])
  return nested.success ? { ...record.data, ...nested.data } : record.data
}

/**
 * Whether any workspace settings file selects the separate judge (an
 * explicit `separate`/`both` engine or a separate source id). Unreadable
 * files select nothing.
 */
export function isSeparateInWorkspace(texts: readonly string[]): boolean {
  return texts.some((text) => {
    const settings = settingsOf(text)
    if (settings === undefined) return false
    const engine = settings[ENGINE_KEY]
    const separate = settings[SEPARATE_KEY]
    return (
      engine === 'separate' ||
      engine === 'both' ||
      (typeof separate === 'string' && separate.trim() !== '')
    )
  })
}
