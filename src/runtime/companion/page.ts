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
  /** Exact served stylesheet paths, entry first: the shared panel styles,
  then the static theme sheets, then the installed local fonts. The theme
  rides a static file because a dynamic JavaScript import never injects
  extracted CSS, and bundling it would charge the entry's CSS budget. */
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
  } catch (error: unknown) {
    throw new Error('EPANEL_PAGE', { cause: error })
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
    // The theme consumer reads its style nonce from the served document, so it
    // must name this document's nonce, never the session render's.
    for (const element of page.querySelectorAll('[data-theme-nonce]')) element.setAttribute('data-theme-nonce', '${nonce}');
    window.fetch = (input, init) => {
      const request = new Request(input instanceof Request ? input : new URL(input, location.href), init);
      if (new URL(request.url).origin !== location.origin) return Promise.reject(new Error('EPANEL_ORIGIN'));
      const headers = new Headers(request.headers);
      headers.set('Authorization', authorization);
      return send(new Request(request, { headers, credentials: 'omit' }));
    };
    // Native script/link loads cannot carry Authorization. Fetch packaged bundles
    // explicitly and install them inline under the existing nonce CSP.
    const fonts = new Map();
    async function fontUrl(reference, base) {
      const resolved = new URL(reference, base);
      if (resolved.origin !== location.origin) return resolved.href;
      const key = resolved.href;
      const cached = fonts.get(key);
      if (cached !== undefined) return cached;
      // A native font load cannot carry Authorization either, so the
      // authenticated bootstrap fetches each packaged font itself and hands
      // the installed sheet a page-owned object URL (see font-src in guard).
      const file = await window.fetch(key);
      if (!file.ok) throw new Error('EPANEL_LAUNCH');
      const object = URL.createObjectURL(
        new Blob([await file.arrayBuffer()], {
          type: file.headers.get('Content-Type') ?? 'font/woff2',
        }),
      );
      fonts.set(key, object);
      return object;
    }
    async function installSheet(text, base) {
      // A bare reference rides its sheet's own directory: resolve it there so
      // it never escapes to the server root, and serve packaged fonts through
      // the authenticated fetch above instead of a bare native load.
      const pattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/g;
      let output = '';
      let cursor = 0;
      for (;;) {
        const match = pattern.exec(text);
        if (match === null) break;
        const reference = match[1] ?? match[2] ?? match[3] ?? '';
        output += text.slice(cursor, match.index);
        cursor = match.index + match[0].length;
        if (reference === '' || /^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(reference)) {
          output += match[0];
        } else {
          const resolved = new URL(reference, base).href;
          if (/\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(resolved)) {
            output += 'url("' + (await fontUrl(reference, base)) + '")';
          } else {
            output += 'url("' + resolved + '")';
          }
        }
      }
      return output + text.slice(cursor);
    }
    for (const element of page.querySelectorAll('script[src], link[rel="stylesheet"]')) {
      const source = element.getAttribute('src') || element.getAttribute('href');
      const asset = await window.fetch(source);
      if (!asset.ok) throw new Error('EPANEL_LAUNCH');
      const inline = page.createElement(element.tagName === 'SCRIPT' ? 'script' : 'style');
      for (const attribute of element.attributes) {
        if (!['src', 'href', 'rel'].includes(attribute.name)) inline.setAttribute(attribute.name, attribute.value);
      }
      inline.setAttribute('nonce', '${nonce}');
      const text = await asset.text();
      inline.textContent =
        element.tagName === 'SCRIPT' ? text : await installSheet(text, new URL(source, location.href).href);
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
