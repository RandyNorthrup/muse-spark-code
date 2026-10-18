// The verified report document as the report tab's iframe carries it (M113).
// Pure: no `vscode` import, so the reporting page's local look builds the
// same document the tab posts. The srcDoc inherits the shell's CSP: only R's
// trusted style gets the shell's nonce; the empty iframe sandbox and the
// shell's policy remain in force.

export function reportDocumentHtml(html: string, nonce: string): string {
  return html
    .replace("style-src 'unsafe-inline'", () => `style-src 'nonce-${nonce}'`)
    .replace('<style>', () => `<style nonce="${nonce}">`)
}
