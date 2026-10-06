import { REPORT_TEXT_COLUMNS } from '../../../shared/constants'
import type { ReportDocument } from '../../../shared/reportSchema'
import { printable, type ReportDisplay } from './display'

/** Count wide CJK/emoji as two terminal cells; never split a grapheme. */
function width(char: string): number {
  if (/^\p{Mark}+$/u.test(char)) return 0
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FF01}-\u{FF60}]/u.test(
    char,
  )
    ? 2
    : 1
}

function wrap(text: string): string {
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })
  return printable(text)
    .split('\n')
    .map((line) => {
      const rows: string[] = []
      let row = ''
      let columns = 0
      for (const { segment: char } of graphemes.segment(line)) {
        const cells = width(char)
        if (columns + cells > REPORT_TEXT_COLUMNS) {
          rows.push(row)
          row = ''
          columns = 0
        }
        row += char
        columns += cells
      }
      rows.push(row)
      return rows.join('\n')
    })
    .join('\n')
}

function rows(headers: readonly string[], data: readonly (readonly string[])[]): string {
  return data
    .map((row) => row.map((cell, index) => `${headers[index] ?? ''}: ${cell}`).join('\n'))
    .join('\n\n')
}

export function textParts(
  document: ReportDocument,
  display: ReportDisplay,
): readonly [string, string] {
  const prefix = `${display.title}\n\n${display.label('scope')}: ${document.header.scope}\n${display.asOf}\n${display.label('version')}: ${document.header.generatorVersion}\nSHA-256: `
  const sections = [document.needsYou, ...document.sections].map((section) => {
    const data = display.sectionTable(section)
    return `${display.label(section.label)}\n${rows(
      data.headers,
      data.rows,
    )}${section.omittedRows > 0 ? `\n${display.more(section.omittedRows)}` : ''}`
  })
  return [
    wrap(prefix),
    wrap(
      `\n\n${sections.join('\n\n')}\n\n${display.label('sources')}\n${rows(display.sources.headers, display.sources.rows)}\n\n${display.footer}\n`,
    ),
  ]
}
