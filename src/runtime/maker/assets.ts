import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID, WEBVIEW_L10N_ELEMENT_ID } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'

// The installed shared panel supplies every view; this script is only its host bridge.
const BRIDGE = `const launch = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
if (launch) {
  const response = await fetch('/launch', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({launch:launch})});
  if (!response.ok) throw new Error('maker-launch-refused');
}
let state;
window.acquireVsCodeApi = () => ({
  getState: () => state,
  setState: value => {state=value;},
  postMessage: message => {void fetch('/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)}).then(async response => {
    if (!response.ok) throw new Error('maker-message-refused');
    if (response.status !== 204) {const result=await response.json(); if(result?.v===1) window.dispatchEvent(new MessageEvent('message',{data:result}));}
  }).catch(error => {window.dispatchEvent(new ErrorEvent('error',{error:error}));});}
});
const events=new EventSource('/events');
events.onmessage=event => {window.dispatchEvent(new MessageEvent('message',{data:JSON.parse(event.data)}));};
await import('/assets/main.js');`

/** Enumerate installed build output, excluding maps, paths from a surface and the workspace. */
export async function companionAssets(distDirectory: string) {
  const assets = new Map<string, { body: string | Uint8Array; type: string }>()
  const root = path.join(distDirectory, 'webview')
  for (const directory of ['', 'chunks']) {
    const files = await readdir(path.join(root, directory), { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile() || !/^[\w.-]+\.(?:js|css)$/.test(file.name)) continue
      const relative = directory === '' ? file.name : `${directory}/${file.name}`
      assets.set(`/assets/${relative}`, {
        body: await readFile(path.join(root, directory, file.name)),
        type: file.name.endsWith('.css') ? 'text/css' : 'text/javascript',
      })
    }
  }
  if (!assets.has('/assets/main.js')) throw new Error('maker-shared-panel-unavailable')
  const title = UI_TEXT.makerTitle
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
  assets.set('/', {
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/assets/main.css"></head><body data-surface="maker"><div id="${WEBVIEW_ROOT_ELEMENT_ID}"></div><script type="application/json" id="${WEBVIEW_L10N_ELEMENT_ID}">${JSON.stringify({ locale: uiLocale(), table: UI_TEXT }).replaceAll('<', String.raw`\u003c`)}</script><script type="module" src="/bridge.js"></script></body></html>`,
    type: 'text/html',
  })
  assets.set('/bridge.js', { body: BRIDGE, type: 'text/javascript' })
  return assets
}
