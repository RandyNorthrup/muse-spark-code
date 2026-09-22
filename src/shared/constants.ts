// Every tunable and user-visible literal lives here. The no-magic-numbers lint
// rule is disabled for this file only; everywhere else a bare literal is an
// error. Keep entries grouped and named for what they mean, not what they are.

export const PRODUCT_NAME = 'Muse Spark'

// Must match package.json `publisher` and `name`; test/unit/manifest.test.ts
// fails if they drift.
export const EXTENSION_PUBLISHER = 'RandyNorthrup'
export const EXTENSION_NAME = 'muse-spark-code'
export const EXTENSION_QUALIFIED_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`

// Contribution point ids (package.json `contributes`).
export const CHAT_VIEW_ID = 'museSpark.chatView'
export const CHAT_PANEL_VIEW_TYPE = 'museSpark.chatPanel'
export const COMMAND_IDS = {
  openInSidebar: 'museSpark.openInSidebar',
  openInNewTab: 'museSpark.openInNewTab',
} as const

// Webview bundle layout produced by scripts/build.mjs.
export const WEBVIEW_DIST_SEGMENTS = ['dist', 'webview'] as const
export const WEBVIEW_SCRIPT_FILE = 'main.js'
export const WEBVIEW_STYLE_FILE = 'main.css'
export const WEBVIEW_ROOT_ELEMENT_ID = 'root'

// Content-Security-Policy nonce: 24 random bytes encode to 32 base64url chars.
export const NONCE_BYTES = 24

// User-visible copy. Mirrors the Claude Code panel wording where the parity
// checklist calls for it.
export const UI_TEXT = {
  untitledConversation: 'Untitled',
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  composerPlaceholder: 'ctrl esc to focus or unfocus Muse',
  composerLabel: 'Message Muse',
  connecting: 'Connecting to the extension host…',
} as const
