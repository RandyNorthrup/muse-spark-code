import { IDE_MCP_TOKEN_BYTES } from '../../shared/constants'
import { UI_TEXT, uiLocale } from '../../shared/l10n/text'

/** The bearer stays in this page's fetch closure, including after installing the trusted UI. */
export function launchPage(nonce: string): string {
  return String.raw`<!doctype html><html lang="${uiLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title></title></head><body><main><p id="launch-error" role="alert" tabindex="-1" data-launch-text="${encodeURIComponent(UI_TEXT.companionLaunchFailed)}" hidden></p></main><script nonce="${nonce}">
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
