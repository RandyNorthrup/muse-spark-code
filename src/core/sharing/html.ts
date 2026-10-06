import { UI_TEXT } from '../../shared/constants'
import { formatDateTime, uiLocale } from '../../shared/l10n/text'
import type { ChatShareDocument } from './chatShare'

/** Text never becomes markup, links, assets or active content. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function heading(kind: string): string {
  if (kind === 'userMessage') return UI_TEXT.exportUserHeading
  return kind === 'agentMessage' ? UI_TEXT.exportAgentHeading : kind
}

/** Self-contained, light/dark system colours; no scripts or remote loads. */
export function renderChatShareHtml(doc: ChatShareDocument): string {
  const sections = doc.items
    .map((item) => {
      const fields = [
        item.text,
        item.tool,
        item.args,
        item.output,
        item.command,
        item.decision,
        item.reasoning,
        item.diff,
      ].filter((text) => text !== undefined)
      const attachments = item.attachments ?? []
      for (const attachment of attachments) {
        if (attachment.name !== undefined) fields.push(attachment.name)
        if (attachment.content !== undefined) fields.push(attachment.content)
      }
      return `<section><h2>${escapeHtml(heading(item.kind))}</h2><pre>${escapeHtml(fields.join('\n\n'))}</pre></section>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="${escapeHtml(uiLocale())}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(doc.title)}</title>
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:Canvas;color:CanvasText;font:1rem/1.6 system-ui,sans-serif}main{max-width:60rem;margin:auto;padding:1rem}h1,h2{overflow-wrap:anywhere}section{border-top:1px solid CanvasText;margin-top:1.5rem}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}time{font-size:.9rem}</style></head>
<body><main><h1>${escapeHtml(doc.title)}</h1><time datetime="${escapeHtml(doc.createdAt)}">${escapeHtml(formatDateTime(Date.parse(doc.createdAt)))}</time>
${sections}</main></body></html>
`
}
