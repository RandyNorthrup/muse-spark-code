import type { ReportDocument } from '../../../shared/reportSchema'
import { printable, type ReportDisplay } from './display'

function escape(text: string): string {
  return printable(text)
    .replaceAll(/[\\`*_{}[\]()#!|<>~&]/g, (char) => `&#${String(char.codePointAt(0))};`)
    .replaceAll('\n', '<br>')
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.map((cell) => escape(cell)).join(' | ')} |`
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    tableRow(headers),
    tableRow(headers.map(() => '---')),
    ...rows.map((cells) => tableRow(cells)),
  ].join('\n')
}

/** Separate around hash metadata so the output scrub can exempt that field alone. */
export function markdownParts(
  document: ReportDocument,
  display: ReportDisplay,
): readonly [string, string] {
  const prefix = `# ${escape(display.title)}\n\n${escape(display.label('scope'))}: ${escape(document.header.scope)}\n\n${escape(display.asOf)}\n\n${escape(display.label('version'))}: ${escape(document.header.generatorVersion)}\n\nSHA-256: `
  const sections = [document.needsYou, ...document.sections].map((section) => {
    const data = display.sectionTable(section)
    const rendered = table(data.headers, data.rows)
    return `## ${escape(display.label(section.label))}\n\n${rendered}${section.omittedRows > 0 ? `\n\n${escape(display.more(section.omittedRows))}` : ''}`
  })
  return [
    prefix,
    `\n\n${sections.join('\n\n')}\n\n## ${escape(display.label('sources'))}\n\n${table(display.sources.headers, display.sources.rows)}\n\n${escape(display.footer)}\n`,
  ]
}
