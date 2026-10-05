/** Anonymous page only exchanges a fragment code; the authenticated UI is injected. */
export function launchPage(nonce: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script nonce="${nonce}">
const code = new URLSearchParams(location.hash.slice(1)).get('k');
history.replaceState(null, '', location.pathname);
if (code) {
  fetch('/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' }, body: JSON.stringify({ code }) })
    .then(response => { if (!response.ok) throw new Error('EPANEL_LAUNCH'); location.replace('/'); });
} else {
  throw new Error('EPANEL_LAUNCH');
}
</script></body></html>`
}
