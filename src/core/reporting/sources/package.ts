import path from 'node:path'
import * as z from 'zod/mini'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import { readReportRows } from './boundary'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  type LocalFileIo,
  type SourceScrub,
} from './local'

const packageScriptSchema = z.strictObject({
  name: z.string(),
  command: z.string().check(z.maxLength(REPORT_MAX_TEXT_CHARS)),
})

/** Node's maintained matcher uses slash segments; npm-run-all2 uses colons. */
function taskPath(text: string): string {
  return text.replaceAll(/[:/]/g, (separator) => (separator === ':' ? '/' : ':'))
}

/** Task declarations only; unsupported glob syntax falls back to an exact name. */
export function matchTaskNames(names: readonly string[], token: string): readonly string[] {
  if (!/[*?[{]/.test(token) || /[()\\]/.test(token)) return names.filter((name) => name === token)
  const pattern = taskPath(token)
  return names.filter((name) => path.posix.matchesGlob(taskPath(name), pattern))
}
/** Declarations only. A report never starts a check or runs a package script. */
export function packageSource(io: LocalFileIo, scrub: SourceScrub) {
  return localSource('package', async ({ signal, reportText }) => {
    const raw: unknown = JSON.parse(await io.read('package.json', signal))
    const envelope = z.object({ scripts: z.record(z.string(), z.unknown()) }).safeParse(raw)
    if (!envelope.success) throw new LocalSourceError('invalid')
    // Each script entry parses on its own: one damaged declaration is a
    // named problem beside the good rows, never a lost manifest
    // (RVREPORTJOIN P2-1).
    const recovered = readReportRows(
      reportText,
      'gates',
      'package/scripts',
      Object.entries(envelope.data.scripts).map(([name, command]) => ({ name, command })),
      packageScriptSchema,
    )
    const scripts: Record<string, string> = {}
    for (const row of recovered.rows) scripts[row.name] = row.command
    if (Object.keys(scripts).length > REPORT_MAX_ROWS) throw new LocalSourceError('limit')
    const partial = recovered.problems.map((problem) => problem.reason).join(' ')
    const included = new Set<string>()
    const visit = (name: string) => {
      if (included.has(name)) return
      const command = scripts[name]
      if (command === undefined) return
      included.add(name)
      // Covers npm run and this repository's npm-run-all2 run-s/run-p declarations.
      for (const match of command.matchAll(/\bnpm(?:\.cmd)? run ([\w:.-]+)/gu))
        visit(match[1] ?? '')
      for (const match of command.matchAll(/\b(?:run-s|run-p)\s+([^&|;]+)/gu)) {
        const tokens = (match[1] ?? '').trim().split(/\s+/u)
        const names = Object.keys(scripts)
        for (const token of tokens) {
          if (token.startsWith('-')) continue
          const matched = matchTaskNames(names, token)
          for (const key of matched) visit(key)
        }
      }
    }
    visit('quality')
    if (included.size === 0) throw new LocalSourceError('missing')
    return {
      data: {
        qualityScripts: [...included]
          .toSorted(codeUnitCompare)
          .map((name) => ({ name: scrub(name), command: scrub(scripts[name] ?? '') })),
      },
      ...(partial !== '' && { partial }),
    }
  })
}
