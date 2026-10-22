// Positioned local JSON checks, shared by editor adapters without a reporting
// JSON service. No schema downloads, file reads or language-server process.
import * as z from 'zod/mini'
import {
  commandRuleSchema,
  permissionProfileSchema,
  repositoryRulesSchema,
} from '../permissionSettings'
import { fill, UI_TEXT } from '../../shared/l10n/text'

export interface JsonProblem {
  readonly offset: number
  readonly message: string
}

const COMMENTS = /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g
// Only erase a comma after a value's final character. A comma after an
// opener, colon or another comma is missing a member/element, not trailing.
const TRAILING_COMMAS = /"(?:\\.|[^"\\])*"(?:\s*,(?=\s*[}\]]))?|[}\]\del]\s*,(?=\s*[}\]])/g
const SETTING_SCHEMAS = {
  'museSpark.modelApiCommandRules': z.array(commandRuleSchema),
  'museSpark.modelApiPermissionProfiles': z.record(z.string(), permissionProfileSchema),
  'museSpark.modelApiRepositoryRules': repositoryRulesSchema,
}
const settingsObject = z.record(z.string(), z.unknown())

/** JSONC whitespace substitutions preserve UTF-16 offsets, including CRLF. */
function parseText(text: string, isJsonc: boolean): string {
  const withoutBom = text.replace(/^\u{FEFF}/u, ' ')
  return isJsonc
    ? withoutBom
        .replaceAll(COMMENTS, (token) =>
          token.startsWith('/') ? token.replaceAll(/[^\r\n]/g, ' ') : token,
        )
        .replaceAll(TRAILING_COMMAS, (token) =>
          token.endsWith(',') ? `${token.slice(0, -1)} ` : token,
        )
    : withoutBom
}

// V8 omits a position for some unexpected-token errors. Consume complete
// JSON tokens to find the first invalid one without echoing its preview.
function unexpectedOffset(text: string): number {
  const tokens =
    /"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[\s{}[\],:]|./gs
  for (const match of text.matchAll(tokens)) {
    if (!/^(?:"|true$|false$|null$|-?\d|[\s{}[\],:]$)/.test(match[0])) return match.index
  }
  return 0
}

export function jsonDiagnostics(
  text: string,
  relative: string,
  isJsonc: boolean,
): readonly JsonProblem[] {
  let value: unknown
  try {
    value = JSON.parse(parseText(text, isJsonc))
  } catch (error: unknown) {
    const description = error instanceof Error ? error.message : ''
    const position = /position (\d+)/.exec(description)?.[1]
    let offset =
      position === undefined
        ? unexpectedOffset(parseText(text, isJsonc))
        : Math.min(Number(position), text.length)
    if (position === undefined && description.includes('end of JSON')) offset = text.length
    return [
      {
        offset,
        message: description.includes("Expected ','")
          ? UI_TEXT.jsonExpectedComma
          : UI_TEXT.jsonInvalidSyntax,
      },
    ]
  }
  const normalized = relative.replaceAll('\\', '/')
  const isSettings = normalized === '.vscode/settings.json'
  const isWorkspace = normalized.endsWith('.code-workspace')
  if (!isSettings && !isWorkspace) return []
  const root = settingsObject.safeParse(value)
  const settings = settingsObject.safeParse(isWorkspace ? root.data?.['settings'] : value)
  if (!settings.success) return []
  const problems: JsonProblem[] = []
  for (const [key, schema] of Object.entries(SETTING_SCHEMAS)) {
    if (!Object.hasOwn(settings.data, key)) continue
    if (!schema.safeParse(settings.data[key]).success) {
      problems.push({
        offset: Math.max(0, text.indexOf(JSON.stringify(key))),
        message: fill(UI_TEXT.jsonInvalidSetting, { setting: key }),
      })
    }
  }
  return problems
}
