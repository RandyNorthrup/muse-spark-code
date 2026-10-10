import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  sourceReason,
  type LocalFileIo,
  type SourceScrub,
} from './local'
import type { ReportSourcePayloads } from './types'

export function certificationSource(io: LocalFileIo, scrub: SourceScrub) {
  return localSource('certification', async ({ signal }) => {
    const records: ReportSourcePayloads['certification']['records'][number][] = []
    const failures: string[] = []
    let visited = 0
    async function walk(directory: string): Promise<void> {
      const entries = [...(await io.list(directory, signal))].toSorted((a, b) =>
        codeUnitCompare(a.name, b.name),
      )
      for (const entry of entries) {
        signal.throwIfAborted()
        if (visited >= REPORT_MAX_ROWS) throw new LocalSourceError('limit')
        visited += 1
        const file = `${directory}/${entry.name}`
        if (entry.directory) {
          await walk(file)
          continue
        }
        const id = /^(m\d+[a-z\d]*)(?:[-.]|$)/iu.exec(entry.name)?.[1]
        if (id === undefined || !entry.name.endsWith('.md')) continue
        try {
          const text = await io.read(file, signal)
          const checklist = text.split(/\r?\n/u).flatMap((line) => {
            const match = /^\s*- \[([ xX])\] (.+)$/u.exec(line)
            if (match === null) return []
            if (line.length > REPORT_MAX_TEXT_CHARS) throw new LocalSourceError('limit')
            return [{ text: scrub(match[2] ?? ''), done: match[1]?.toLowerCase() === 'x' }]
          })
          if (checklist.length > REPORT_MAX_ROWS) throw new LocalSourceError('limit')
          records.push({
            path: scrub(file),
            milestoneId: id.toLowerCase().replace(/^m/u, 'M'),
            checklist,
          })
        } catch {
          failures.push(scrub(file))
        }
      }
    }
    await walk('docs/certification')
    if (failures.length > 0 && records.length === 0) throw new LocalSourceError('failed')
    return { data: { records }, ...(failures.length > 0 && { partial: sourceReason('failed') }) }
  })
}
