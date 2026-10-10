import { REPORT_TEXT_COLUMNS } from '../../../shared/constants'
import type { ReportDocument } from '../../../shared/reportSchema'
import { printable, type ReportDisplay } from './display'

// Generated Unicode 16.0.0 East_Asian_Width W/F ranges from CPython 3.14's
// unicodedata.east_asian_width, including default wide unassigned ranges.
const WIDE_EAST_ASIAN =
  /[\u{1100}-\u{115F}]|[\u{231A}-\u{231B}]|[\u{2329}-\u{232A}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{25FD}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2630}-\u{2637}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{268A}-\u{268F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2705}]|[\u{270A}-\u{270B}]|[\u{2728}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2795}-\u{2797}]|[\u{27B0}]|[\u{27BF}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{2E80}-\u{2E99}]|[\u{2E9B}-\u{2EF3}]|[\u{2F00}-\u{2FD5}]|[\u{2FF0}-\u{303E}]|[\u{3041}-\u{3096}]|[\u{3099}-\u{30FF}]|[\u{3105}-\u{312F}]|[\u{3131}-\u{318E}]|[\u{3190}-\u{31E5}]|[\u{31EF}-\u{321E}]|[\u{3220}-\u{3247}]|[\u{3250}-\u{A48C}]|[\u{A490}-\u{A4C6}]|[\u{A960}-\u{A97C}]|[\u{AC00}-\u{D7A3}]|[\u{F900}-\u{FAFF}]|[\u{FE10}-\u{FE19}]|[\u{FE30}-\u{FE52}]|[\u{FE54}-\u{FE66}]|[\u{FE68}-\u{FE6B}]|[\u{FF01}-\u{FF60}]|[\u{FFE0}-\u{FFE6}]|[\u{16FE0}-\u{16FE4}]|[\u{16FF0}-\u{16FF1}]|[\u{17000}-\u{187F7}]|[\u{18800}-\u{18CD5}]|[\u{18CFF}-\u{18D08}]|[\u{1AFF0}-\u{1AFF3}]|[\u{1AFF5}-\u{1AFFB}]|[\u{1AFFD}-\u{1AFFE}]|[\u{1B000}-\u{1B122}]|[\u{1B132}]|[\u{1B150}-\u{1B152}]|[\u{1B155}]|[\u{1B164}-\u{1B167}]|[\u{1B170}-\u{1B2FB}]|[\u{1D300}-\u{1D356}]|[\u{1D360}-\u{1D376}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F18E}]|[\u{1F191}-\u{1F19A}]|[\u{1F200}-\u{1F202}]|[\u{1F210}-\u{1F23B}]|[\u{1F240}-\u{1F248}]|[\u{1F250}-\u{1F251}]|[\u{1F260}-\u{1F265}]|[\u{1F300}-\u{1F320}]|[\u{1F32D}-\u{1F335}]|[\u{1F337}-\u{1F37C}]|[\u{1F37E}-\u{1F393}]|[\u{1F3A0}-\u{1F3CA}]|[\u{1F3CF}-\u{1F3D3}]|[\u{1F3E0}-\u{1F3F0}]|[\u{1F3F4}]|[\u{1F3F8}-\u{1F43E}]|[\u{1F440}]|[\u{1F442}-\u{1F4FC}]|[\u{1F4FF}-\u{1F53D}]|[\u{1F54B}-\u{1F54E}]|[\u{1F550}-\u{1F567}]|[\u{1F57A}]|[\u{1F595}-\u{1F596}]|[\u{1F5A4}]|[\u{1F5FB}-\u{1F64F}]|[\u{1F680}-\u{1F6C5}]|[\u{1F6CC}]|[\u{1F6D0}-\u{1F6D2}]|[\u{1F6D5}-\u{1F6D7}]|[\u{1F6DC}-\u{1F6DF}]|[\u{1F6EB}-\u{1F6EC}]|[\u{1F6F4}-\u{1F6FC}]|[\u{1F7E0}-\u{1F7EB}]|[\u{1F7F0}]|[\u{1F90C}-\u{1F93A}]|[\u{1F93C}-\u{1F945}]|[\u{1F947}-\u{1F9FF}]|[\u{1FA70}-\u{1FA7C}]|[\u{1FA80}-\u{1FA89}]|[\u{1FA8F}-\u{1FAC6}]|[\u{1FACE}-\u{1FADC}]|[\u{1FADF}-\u{1FAE9}]|[\u{1FAF0}-\u{1FAF8}]|[\u{20000}-\u{2FFFD}]|[\u{30000}-\u{3FFFD}]/u

/** Count Unicode W/F and emoji as two terminal cells; never split a grapheme. */
function width(char: string): number {
  if (/^\p{Mark}+$/u.test(char)) return 0
  return WIDE_EAST_ASIAN.test(char) ||
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(char)
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
    .map((row) => row.map((cell, index) => `${headers[index] ?? ''}: ${cell}`.trimEnd()).join('\n'))
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
