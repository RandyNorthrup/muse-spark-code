// The workspace's confidential policy (M118), read afresh at each admission
// by sharing and by the M124 connector; an unreadable policy refuses.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { SETTING_DEFAULTS } from '../../shared/constants'

const policySchema = z.object({ 'museSpark.confidentialWorkspace': z.optional(z.boolean()) })

/**
 * Settings files are JSONC: strip line and block comments and trailing
 * commas before parsing, so a commented settings file still reads (Codex on
 * PR #227). Strings are honored, so a comment-looking value survives.
 */
function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  let isInString = false
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (isInString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') isInString = false
      i += 1
      continue
    }
    if (ch === '"') {
      isInString = true
      out += ch
      i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j] ?? '')) j += 1
      const next = text[j] ?? ''
      if (next === '}' || next === ']') {
        i += 1
        continue
      }
    } else if (ch === '}' || ch === ']') {
      // A trailing comma can hide before a comment (`false, // note\n}`):
      // drop it when the brace lands.
      out = out.replace(/,\s*$/, '')
    }
    out += ch
    i += 1
  }
  return out
}

/** Read the existing workspace setting afresh at each admission; unavailable policy refuses. */
export function runtimeSharingConfidential(cwd: string): boolean | undefined {
  try {
    return (
      policySchema.parse(
        JSON.parse(stripJsonc(readFileSync(path.join(cwd, '.vscode', 'settings.json'), 'utf8'))),
      )['museSpark.confidentialWorkspace'] ?? SETTING_DEFAULTS.confidentialWorkspace
    )
  } catch (error: unknown) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? SETTING_DEFAULTS.confidentialWorkspace
      : undefined
  }
}
