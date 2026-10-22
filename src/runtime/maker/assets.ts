import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID, WEBVIEW_L10N_ELEMENT_ID } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'

// The installed shared panel supplies every view; this script is only its host bridge.
// Both directions parse with the deferred maker schemas; /events opens only once they load.
// A reloaded document resumes its cookie session; only a first load spends the one-shot launch code.
const BRIDGE = `let state;
let connect;
const connected=new Promise(resolve=>{connect=resolve;});
window.acquireVsCodeApi = () => ({
  getState: () => state,
  setState: value => {state=value;},
  postMessage: raw => {void (async () => {
    await connected;
    const {companionPresenceSchema}=await ready;
    const {makerHostMessageSchema,makerSurfaceMessageSchema}=await schemas;
    const message=makerSurfaceMessageSchema.parse(raw);
    const headers={'Content-Type':'application/json'};
    const answering=message.type==='makerAnswer';
    if(answering) {
      if(message.answer.decision==='allow_once') {
        const presence=await fetch('/presence',{method:'POST',headers,body:JSON.stringify(message)});
        const result=companionPresenceSchema.parse(await presence.json());
        if('error' in result) throw new Error(result.error);
        headers['X-Maker-Approval']=result.grant;
      }
    }
    const response=await fetch(answering?'/answer':'/message',{method:'POST',headers,body:JSON.stringify(message)});
    if(!response.ok) throw new Error('maker-message-refused');
    if(response.status!==204){const result=await response.json();const parsed=makerHostMessageSchema.safeParse(result); if(parsed.success) window.dispatchEvent(new MessageEvent('message',{data:parsed.data}));}
  })().catch(error=>{window.dispatchEvent(new ErrorEvent('error',{error:error}));});}
});
const ready=import('/assets/main.js');
const schemas=ready.then(main=>main.makerBoundarySchemas());
const {companionBootstrapSchema,companionLaunchSchema}=await ready;
let response=await fetch('/session',{method:'POST'});
if(!response.ok) {
const delivery=await fetch('/launch-code',{method:'POST'});
if(!delivery.ok) throw new Error('maker-launch-refused');
const launch=companionLaunchSchema.parse(await delivery.json());
response=await fetch('/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(launch)});
if(!response.ok) throw new Error('maker-launch-refused');
}
const bootstrap=companionBootstrapSchema.parse(await response.json());
window.museSparkThonnyProvider=bootstrap.provider;
connect();
const {makerHostMessageSchema}=await schemas;
const events=new EventSource('/events');
events.onmessage=event=>{window.dispatchEvent(new MessageEvent('message',{data:makerHostMessageSchema.parse(JSON.parse(event.data))}));};`

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
}
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
  const title = escape(UI_TEXT.makerTitle)
  assets.set('/', {
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/assets/main.css"></head><body data-surface="maker"><div id="${WEBVIEW_ROOT_ELEMENT_ID}"></div><script type="application/json" id="${WEBVIEW_L10N_ELEMENT_ID}">${JSON.stringify({ locale: uiLocale(), table: UI_TEXT }).replaceAll('<', String.raw`\u003c`)}</script><script type="module" src="/bridge.js"></script></body></html>`,
    type: 'text/html',
  })
  assets.set('/bridge.js', { body: BRIDGE, type: 'text/javascript' })
  return assets
}
