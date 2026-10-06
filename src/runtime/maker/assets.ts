import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  UI_TEXT,
  WEBVIEW_ROOT_ELEMENT_ID,
  WEBVIEW_L10N_ELEMENT_ID,
  RUNTIME_MAKER_LAUNCH_CODE_LENGTH,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'

// The installed shared panel supplies every view; this script is only its host bridge.
const BRIDGE = `history.replaceState(null, '', location.pathname);
const form=document.getElementById('maker-launch');
const error=document.getElementById('maker-launch-error');
const bootstrap=await new Promise(resolve=>{
  form.addEventListener('submit',event=>{event.preventDefault();void(async()=>{
    const launch=document.getElementById('maker-code').value;
    const response=await fetch('/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({launch:launch})});
    if(!response.ok) throw new Error('maker-launch-refused');
    const result=await response.json();
    document.getElementById('maker-code').value='';
    form.hidden=true;
    error.hidden=true;
    resolve(result);
  })().catch(()=>{error.hidden=false;});});
});
const approvalKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(bootstrap.approvalKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
async function proof(id) {
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',approvalKey,new TextEncoder().encode(id)));
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
window.museSparkThonnyProvider=bootstrap.provider;
let state;
window.acquireVsCodeApi = () => ({
  getState: () => state,
  setState: value => {state=value;},
  postMessage: message => {void (async () => {
    const headers={'Content-Type':'application/json'};
    const answering=message.type==='makerAnswer';
    if(answering) {
      if(!approvalKey) throw new Error('maker-answer-refused');
      headers['X-Maker-Approval']=await proof(message.answer.id);
    }
    const response=await fetch(answering?'/answer':'/message',{method:'POST',headers:headers,body:JSON.stringify(message)});
    if (!response.ok) throw new Error('maker-message-refused');
    if (response.status !== 204) {const result=await response.json(); if(result?.v===1) window.dispatchEvent(new MessageEvent('message',{data:result}));}
  })().catch(error => {window.dispatchEvent(new ErrorEvent('error',{error:error}));});}

});
const events=new EventSource('/events');
events.onmessage=event => {window.dispatchEvent(new MessageEvent('message',{data:JSON.parse(event.data)}));};
await import('/assets/main.js');`

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
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/assets/main.css"></head><body data-surface="maker"><form id="maker-launch"><label for="maker-code">${escape(UI_TEXT.makerLaunchPrompt)}</label><input id="maker-code" maxlength="${String(RUNTIME_MAKER_LAUNCH_CODE_LENGTH)}" autocomplete="off" required><button type="submit">${escape(UI_TEXT.makerLaunchConnect)}</button></form><p id="maker-launch-error" hidden>${escape(UI_TEXT.makerLaunchDenied)}</p><div id="${WEBVIEW_ROOT_ELEMENT_ID}"></div><script type="application/json" id="${WEBVIEW_L10N_ELEMENT_ID}">${JSON.stringify({ locale: uiLocale(), table: UI_TEXT }).replaceAll('<', String.raw`\u003c`)}</script><script type="module" src="/bridge.js"></script></body></html>`,
    type: 'text/html',
  })
  assets.set('/bridge.js', { body: BRIDGE, type: 'text/javascript' })
  return assets
}
