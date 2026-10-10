import { escapeHtml } from '../../core/htmlText'
import { IDE_MCP_TOKEN_BYTES, WEBVIEW_L10N_ELEMENT_ID } from '../../shared/constants'
import { UI_TEXT, uiLocale } from '../../shared/l10n/text'

const NONCE_PATTERN = /^[a-f\d]{32,}$/
const STYLESHEET_PATTERN = /^\/[A-Za-z\d._-]+(?:\/[A-Za-z\d._-]+)*\.css$/
const MODULE_PATTERN = /^\/[A-Za-z\d._-]+(?:\/[A-Za-z\d._-]+)*\.js$/
const SPECIFIER_PATTERN = /^[\w@./-]+$/

/** M114 C-M114-1: the companion's themed page assembly. Every boundary is validated; a violation throws, never an unthemed or half-escaped page. */
export interface CompanionPageContent {
  /** The installed display language for the document element. */
  readonly locale: string
  /** Caller-localized document title (installed display text, escaped here). */
  readonly title: string
  /**
   * Exact served stylesheet paths, entry first: the shared panel styles,
   * then the static theme sheets, then the installed local fonts. The theme
   * rides a static file because a dynamic JavaScript import never injects
   * extracted CSS, and bundling it would charge the entry's CSS budget.
   */
  readonly stylesheets: readonly string[]
  /** The page's module scripts as exact served paths, entry last. */
  readonly modules: readonly string[]
  /** Bare import-map specifiers to their packaged URLs. */
  readonly imports: Readonly<Record<string, string>>
  /** Embedded JSON documents, stringified and escaped here. */
  readonly uiTable: unknown
  readonly usageTable: unknown
}

function embeddedJson(value: unknown): string {
  if (value === undefined || typeof value === 'function') throw new Error('EPANEL_PAGE')
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    throw new Error('EPANEL_PAGE')
  }
  return text.replaceAll('<', String.raw`\u003c`)
}

/** The authenticated companion page: themed root, packaged assets only, nonce on every script. No credential or launch code is passed. */
export function renderCompanionPage(nonce: string, content: CompanionPageContent): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('EPANEL_PAGE')
  for (const sheet of content.stylesheets)
    if (!STYLESHEET_PATTERN.test(sheet)) throw new Error('EPANEL_PAGE')
  for (const module of content.modules)
    if (!MODULE_PATTERN.test(module)) throw new Error('EPANEL_PAGE')
  for (const [specifier, url] of Object.entries(content.imports)) {
    if (
      !SPECIFIER_PATTERN.test(specifier) ||
      (!url.startsWith('data:text/javascript;charset=utf-8,') && !MODULE_PATTERN.test(url))
    )
      throw new Error('EPANEL_PAGE')
  }
  const links = content.stylesheets
    .map((sheet) => `<link rel="stylesheet" href="${sheet}">`)
    .join('')
  const scripts = content.modules
    .map((module) => `<script type="module" nonce="${nonce}" src="${module}"></script>`)
    .join('')
  return `<!doctype html><html lang="${escapeHtml(content.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.title)}</title>${links}<script nonce="${nonce}" type="importmap">${embeddedJson({ imports: content.imports })}</script><script nonce="${nonce}" id="${WEBVIEW_L10N_ELEMENT_ID}" type="application/json">${embeddedJson(content.uiTable)}</script><script nonce="${nonce}" id="muse-usage-l10n" type="application/json">${embeddedJson(content.usageTable)}</script></head><body data-host-bridge="http"><div id="root" data-theme-nonce="${nonce}"></div>${scripts}</body></html>`
}

/** The bearer stays in this page's fetch closure, including after installing the trusted UI. */
export function launchPage(nonce: string): string {
  return String.raw`<!doctype html><html lang="${escapeHtml(uiLocale())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title></title></head><body><main><p id="launch-error" role="alert" tabindex="-1" data-launch-text="${encodeURIComponent(UI_TEXT.companionLaunchFailed)}" hidden></p></main><script nonce="${nonce}">
(() => {
  const recovery = document.getElementById('launch-error');
  const copy = decodeURIComponent(recovery.dataset.launchText);
  recovery.textContent = copy;
  document.title = copy;
  const code = new URLSearchParams(location.hash.slice(1)).get('k');
  history.replaceState(null, '', location.pathname);
  const send = window.fetch.bind(window);
  async function launch() {
    if (!code) throw new Error('EPANEL_LAUNCH');
    const response = await send('/session', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' }, body: JSON.stringify({ code }) });
    const authorization = response.headers.get('Authorization');
    if (!response.ok || !authorization || !/^Bearer [a-f\d]{${String(IDE_MCP_TOKEN_BYTES * 2)}}$/.test(authorization)) throw new Error('EPANEL_LAUNCH');
    const html = await response.text();
    const page = new DOMParser().parseFromString(html, 'text/html');
    // Keep the original document's CSP nonce when installing the trusted renderer.
    for (const element of page.querySelectorAll('script[nonce], style[nonce]')) element.setAttribute('nonce', '${nonce}');
    window.fetch = (input, init) => {
      const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
      if (new URL(request.url).origin !== location.origin) return Promise.reject(new Error('EPANEL_ORIGIN'));
      const headers = new Headers(request.headers);
      headers.set('Authorization', authorization);
      return send(new Request(request, { headers, credentials: 'omit' }));
    };
    // Native script/link loads cannot carry Authorization. Fetch packaged bundles
    // explicitly and install them inline under the existing nonce CSP.
    for (const element of page.querySelectorAll('script[src], link[rel="stylesheet"]')) {
      const source = element.getAttribute('src') || element.getAttribute('href');
      const asset = await window.fetch(source);
      if (!asset.ok) throw new Error('EPANEL_LAUNCH');
      const inline = page.createElement(element.tagName === 'SCRIPT' ? 'script' : 'style');
      for (const attribute of element.attributes) {
        if (!['src', 'href', 'rel'].includes(attribute.name)) inline.setAttribute(attribute.name, attribute.value);
      }
      inline.setAttribute('nonce', '${nonce}');
      inline.textContent = await asset.text();
      element.replaceWith(inline);
    }
    page.documentElement.dataset.launch = 'ready';
    document.open();
    document.write('<!doctype html>' + page.documentElement.outerHTML);
    document.close();
  }
  void launch().catch(() => {
    document.documentElement.dataset.launch = 'failed';
    const failure = document.getElementById('launch-error');
    if (failure) { failure.hidden = false; failure.focus(); }
  });
})();
</script></body></html>`
}
