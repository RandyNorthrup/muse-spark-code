// The markup contract between What's New's renderer on the host
// (src/host/whatsNew/whatsNewHtml.ts) and its page script
// (src/webview/whatsNew/whatsNewPage.ts), M99, PLAN.md D79: a link's and a
// Try it's index into the host's lists, and the toggle's id, with the
// selectors the script finds them by. It imports nothing, so the page's
// bundle stays a few hundred bytes: constants.ts re-exports the display
// table, which would bring the whole English table in with it (the
// bundle-split gate fails a page bundle that carries any package or the
// table).

export const WHATS_NEW_LINK_ATTRIBUTE = 'data-link'
export const WHATS_NEW_TRY_ATTRIBUTE = 'data-try'
export const WHATS_NEW_TOGGLE_ID = 'hide-on-update'
export const WHATS_NEW_LINK_SELECTOR = 'a[data-link]'
export const WHATS_NEW_TRY_SELECTOR = 'button[data-try]'
export const WHATS_NEW_TOGGLE_SELECTOR = '#hide-on-update'
