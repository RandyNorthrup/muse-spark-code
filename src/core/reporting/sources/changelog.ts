import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  type LocalFileIo,
  type SourceScrub,
} from './local'

/** Keep a Changelog headings; links at the bottom are metadata, not release notes. */
export function changelogSource(io: LocalFileIo, scrub: SourceScrub) {
  return localSource('changelog', async ({ signal }) => {
    const text = await io.read('CHANGELOG.md', signal)
    const sections: { version: string; date: string | null; lines: string[] }[] = []
    let section: (typeof sections)[number] | undefined
    for (const line of text.split(/\r?\n/u)) {
      const heading = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/u.exec(line)
      if (heading) {
        if (sections.length >= REPORT_MAX_ROWS) throw new LocalSourceError('limit')
        section = { version: scrub(heading[1] ?? ''), date: heading[2] ?? null, lines: [] }
        sections.push(section)
      } else if (line.startsWith('## ')) {
        throw new LocalSourceError('invalid')
      } else if (section && line.trim() !== '' && !/^\[[^\]]+\]:/u.test(line)) {
        if (line.length > REPORT_MAX_TEXT_CHARS || section.lines.length >= REPORT_MAX_ROWS)
          throw new LocalSourceError('limit')
        section.lines.push(scrub(line))
      }
    }
    if (
      sections.length === 0 ||
      new Set(sections.map((entry) => entry.version)).size !== sections.length
    )
      throw new LocalSourceError('invalid')
    return {
      data: { sections: sections.toSorted((a, b) => codeUnitCompare(a.version, b.version)) },
    }
  })
}
