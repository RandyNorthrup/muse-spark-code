import type { ReportDocument, ReportTheme } from '../../../shared/reportSchema'
import { printable, type ReportDisplay } from './display'

function escape(text: string): string {
  return printable(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Theme input is data too: only color literals or host color variables enter CSS. */
function color(value: string): string {
  if (
    !/^(?:#(?:[a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})|(?:rgb|rgba|hsl|hsla)\([\d.% ,/+-]+\)|var\(--(?:vscode|ms)-[\w-]+\))$/i.test(
      value,
    )
  ) {
    throw new Error('Invalid report theme color')
  }
  return value
}

function table(
  caption: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return `<div class="table" role="region" aria-label="${escape(caption)}" tabindex="0"><table><caption>${escape(caption)}</caption><thead><tr>${headers.map((header) => `<th scope="col">${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

export function htmlParts(
  document: ReportDocument,
  display: ReportDisplay,
  locale: string,
  theme: ReportTheme,
): readonly [string, string] {
  const css = `:root{color-scheme:light dark}body{margin:1rem;background:${color(theme.background)};color:${color(theme.foreground)};font-family:system-ui,sans-serif;overflow-wrap:anywhere}h1,h2{color:${color(theme.accent)}}.table{overflow-x:auto}.table:focus-visible{outline:2px solid ${color(theme.accent)}}table{border-collapse:collapse;width:100%}caption{text-align:start;font-weight:bold}th,td{border:1px solid ${color(theme.border)};padding:.5rem;text-align:start;white-space:pre-wrap;overflow-wrap:normal}footer{color:${color(theme.muted)};margin-top:1rem}code{overflow-wrap:anywhere}`
  const prefix = `<!doctype html>\n<html lang="${escape(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(display.title)}</title><style>${css}</style></head><body><header><h1>${escape(display.title)}</h1><p>${escape(display.label('scope'))}: ${escape(document.header.scope)}</p><p>${escape(display.asOf)}</p><p>${escape(display.label('version'))}: ${escape(document.header.generatorVersion)}</p><p>SHA-256: <code>`
  const sections = [document.needsYou, ...document.sections].map((section) => {
    const title = display.label(section.label)
    const data = display.sectionTable(section)
    return `<section><h2>${escape(title)}</h2>${table(
      title,
      data.headers,
      data.rows,
    )}${section.omittedRows > 0 ? `<p>${escape(display.more(section.omittedRows))}</p>` : ''}</section>`
  })
  return [
    prefix,
    `</code></p></header><main>${sections.join('')}<section><h2>${escape(display.label('sources'))}</h2>${table(display.label('sources'), display.sources.headers, display.sources.rows)}</section></main><footer>${escape(display.footer)}</footer></body></html>\n`,
  ]
}
