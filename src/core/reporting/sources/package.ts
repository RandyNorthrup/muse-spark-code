import * as z from 'zod/mini'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  type LocalFileIo,
  type SourceScrub,
} from './local'

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string().check(z.maxLength(REPORT_MAX_TEXT_CHARS))),
})
/** Declarations only. A report never starts a check or runs a package script. */
export function packageSource(io: LocalFileIo, scrub: SourceScrub) {
  return localSource('package', async ({ signal }) => {
    const raw: unknown = JSON.parse(await io.read('package.json', signal))
    const { scripts } = packageSchema.parse(raw)
    if (Object.keys(scripts).length > REPORT_MAX_ROWS) throw new LocalSourceError('limit')
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
        for (const token of tokens) {
          if (token.startsWith('-')) continue
          if (token.includes('*')) {
            const prefix = token.slice(0, token.indexOf('*'))
            for (const key of Object.keys(scripts)) if (key.startsWith(prefix)) visit(key)
          } else visit(token)
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
    }
  })
}
