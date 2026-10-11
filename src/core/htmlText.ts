const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** One encoding pass keeps text inert in elements and quoted attributes. */
export function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}
