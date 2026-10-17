// M124 (D106, design §4): our approval surface for the local connector. It
// is a page on M104 C's companion server (loopback only, one-use launch code
// in the URL fragment exchanged for a per-window bearer held in page memory,
// exact Origin and CSP checks), opened in the user's own browser, so it
// serves every editor equally. The MCP channel has no route to it: only this
// page's authenticated click settles an intent, bound to the digest it showed.
import { escapeHtml } from '../../core/htmlText'
import { CONNECTOR_COMPANION_LIMITS } from '../../shared/constants'
import {
  connectorDecisionSchema,
  connectorPageEventSchema,
  type ConnectorDecision,
  type ConnectorIntentView,
} from '../../shared/connector'
import { UI_TEXT, uiLocale } from '../../shared/l10n/text'
import { startCompanionServer } from '../companion/server'

export interface ApprovalOwner {
  readonly pending: () => ConnectorIntentView[]
  readonly decide: (intentId: string, digest: string, isApproved: boolean) => boolean
}

/** The page's script: text nodes only, never HTML from a request. */
const PAGE_SCRIPT = String.raw`
(() => {
const text = JSON.parse(document.getElementById('connector-text').textContent);
const list = document.getElementById('intents');
const status = document.getElementById('status');
const say = (words) => { status.textContent = words; };
const row = (dl, label, value) => {
const dt = document.createElement('dt'); dt.textContent = label;
const dd = document.createElement('dd'); dd.textContent = value;
dl.append(dt, dd);
};
const labels = { title: text.fieldTitle, scope: text.fieldScope, tags: text.fieldTags, body: text.fieldBody };
async function decide(intent, approve) {
const response = await fetch('/post', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' }, body: JSON.stringify({ type: 'decide', intentId: intent.intentId, digest: intent.digest, approve }) });
say(response.ok ? (approve ? text.approved : text.denied) : text.decisionFailed);
}
function render(intents) {
list.replaceChildren();
if (intents.length === 0) { say(text.empty); return; }
say('');
for (const intent of intents) {
const item = document.createElement('li');
const heading = document.createElement('h2');
heading.id = 'intent-' + intent.intentId;
heading.textContent = intent.tool + ' · ' + intent.workspace;
const dl = document.createElement('dl');
row(dl, text.client, intent.client);
row(dl, text.connection, intent.connectionId);
row(dl, text.operation, intent.toolClass);
row(dl, text.generation, String(intent.generation));
row(dl, text.price, intent.priceMicrousd === 0 ? text.free : String(intent.priceMicrousd));
row(dl, text.expires, new Date(intent.expiresAt).toLocaleTimeString());
for (const field of intent.fields) {
const label = labels[field.label] || field.label;
if (field.label === 'body') {
const dt = document.createElement('dt'); dt.textContent = label;
const dd = document.createElement('dd');
const pre = document.createElement('pre'); pre.textContent = field.value; dd.append(pre);
dl.append(dt, dd);
} else row(dl, label, field.value);
}
const approve = document.createElement('button');
approve.type = 'button'; approve.textContent = text.approve;
approve.setAttribute('aria-describedby', heading.id);
approve.addEventListener('click', () => { void decide(intent, true); });
const deny = document.createElement('button');
deny.type = 'button'; deny.textContent = text.deny;
deny.setAttribute('aria-describedby', heading.id);
deny.addEventListener('click', () => { void decide(intent, false); });
const section = document.createElement('section');
section.setAttribute('aria-labelledby', heading.id);
section.append(heading, dl, approve, deny);
item.append(section);
list.append(item);
}
}
async function stream() {
say(text.loading);
const response = await fetch('/events', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' }, body: '{}' });
if (!response.ok || response.body === null) throw new Error('EPANEL_STREAM');
const reader = response.body.getReader();
const decoder = new TextDecoder('utf-8', { fatal: true });
let pending = '';
for (;;) {
const chunk = await reader.read();
if (chunk.done) throw new Error('EPANEL_CLOSED');
pending += decoder.decode(chunk.value, { stream: true });
let boundary = pending.indexOf('\n\n');
while (boundary !== -1) {
const frame = pending.slice(0, boundary);
pending = pending.slice(boundary + 2);
if (frame.startsWith('data: ')) render(JSON.parse(frame.slice(6)).intents);
boundary = pending.indexOf('\n\n');
}
}
}
const retry = document.getElementById('retry');
retry.addEventListener('click', () => { location.reload(); });
void stream().catch(() => { say(text.failed); retry.hidden = false; retry.focus(); });
})();
`

function renderPage(nonce: string): string {
  // Escaped for its <script> block, as the usage panel's table is.
  const text = JSON.stringify(UI_TEXT.acpConnector)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('\u{2028}', String.raw`\u2028`)
    .replaceAll('\u{2029}', String.raw`\u2029`)
  const title = escapeHtml(UI_TEXT.acpConnector.title)
  return `<!doctype html><html lang="${escapeHtml(uiLocale())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title><style nonce="${nonce}">body{font-family:system-ui,sans-serif;margin:0 auto;max-width:48rem;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}dt{font-weight:bold}button{margin-inline-end:.5rem;min-height:2.75rem;min-width:2.75rem}</style></head><body><main><h1>${title}</h1><p>${escapeHtml(UI_TEXT.acpConnector.intro)}</p><p id="status" role="status" aria-live="polite"></p><button id="retry" type="button" hidden>${escapeHtml(UI_TEXT.acpConnector.retry)}</button><ul id="intents"></ul></main><script nonce="${nonce}" id="connector-text" type="application/json">${text}</script><script nonce="${nonce}">${PAGE_SCRIPT}</script></body></html>`
}

export interface ApprovalPage {
  /** Resolves when the real listener and idle timer have retired. */
  readonly closed: Promise<void>
  readonly launchUrl: () => string
  /** Whether a page window is connected and showing the list. */
  readonly isWatched: () => boolean
  readonly changed: () => void
  readonly close: () => Promise<void>
}

/** Starts the loopback page; the caller opens its launch URL in the user's browser. */
export async function startApprovalPage(owner: ApprovalOwner): Promise<ApprovalPage> {
  const listeners = new Set<(message: unknown) => void>()
  const snapshot = () =>
    connectorPageEventSchema.parse({ type: 'intents', intents: owner.pending() })
  const server = await startCompanionServer<ConnectorDecision, unknown>({
    limits: CONNECTOR_COMPANION_LIMITS,
    assets: new Map(),
    renderPage,
    handler: {
      inputSchema: connectorDecisionSchema,
      outputSchema: connectorPageEventSchema,
      subscribe: (_session, emit) => {
        listeners.add(emit)
        emit(snapshot())
        return () => {
          listeners.delete(emit)
        }
      },
      post: (decision) => {
        // A refused decision (changed, expired, settled) answers an error status.
        if (!owner.decide(decision.intentId, decision.digest, decision.approve))
          throw new Error('ECONNECTOR_DECISION')
        return Promise.resolve()
      },
    },
  })
  return {
    closed: server.closed,
    launchUrl: () => server.launchUrl(),
    isWatched: () => listeners.size > 0,
    changed: () => {
      const message = snapshot()
      for (const emit of listeners) emit(message)
    },
    close: () => server.close(),
  }
}
