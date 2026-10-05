// The browser check's tunables (M81, PLAN.md D49; A1, design spec v4),
// re-exported by constants.ts. This module imports nothing: the check's own
// bundle (dist/browserCheck.js, capped at 50 KiB) and the runtime's
// (dist/browserRuntime.js) read it directly, without the rest of
// constants.ts.
//
// The model opens a local page in the pinned Chrome-for-Testing headless
// shell and gets back a screenshot (Model API only), the console errors and
// the failed requests. The same tool on the `ide` session server for Muse
// Code. The shell is downloaded once after the user's consent, verified
// against the pin this release ships (browserRuntime.json), and confined by
// the extension's own proxy (checkProxy.ts).

// A mebibyte, local: constants.ts's BYTES_PER_MIB is not imported here.
const MIB = 1024 * 1024
export const IDE_BROWSER_CHECK_TOOL = 'browserCheck'
// The approval card's subjects on the Model API backend: `target` is the
// URL; the second names a host only the card can widen the check to.
export const BROWSER_CHECK_SUBJECT_KIND = 'browserCheck'
export const BROWSER_CHECK_WIDEN_SUBJECT_KIND = 'browserCheckWiden'
// The browser's own bundle (the pipe, the run, the proxy, the processes),
// beside dist/extension.js: loaded on the first check, not at activation.
export const BROWSER_CHECK_BUNDLE_FILE = 'browserCheck.js'
// The runtime's acquisition (the pin, the download, the ZIP reader, the
// store): a bundle of its own, loaded when a runtime is prepared or verified.
export const BROWSER_RUNTIME_BUNDLE_FILE = 'browserRuntime.js'
// `museSpark.browserCheckRuntime`: ask before the download, download without
// asking (consent to every later pin), or no browser check at all.
export const BROWSER_RUNTIME_MODES = ['ask', 'download', 'off'] as const
export type BrowserRuntimeMode = (typeof BROWSER_RUNTIME_MODES)[number]
// The resolver rule (spec §3.5): every name the browser would resolve fails
// before any lookup, except the exact numeric proxy endpoint and the IPv6
// loopback literal. No name, suffix or 127.* exclusion: the owned proxy
// resolves approved names itself.
export const BROWSER_HOST_RESOLVER_RULES = 'MAP * ^NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE ::1'
// The only bypass entry: subtract Chrome's implicit loopback and link-local
// bypass, so loopback goes through the proxy too (spec §3.3).
export const BROWSER_PROXY_BYPASS = '<-loopback>'
// The integrated-auth allowlist holds only this reserved name: no ambient
// sign-in to any real host on the command line's network context. Never
// admitted as a widened host or a CONNECT target.
export const BROWSER_AUTH_SENTINEL = 'muse-spark-no-ambient-auth.invalid'
export const BROWSER_PROXY_SERVER_FLAG = '--proxy-server='
export const BROWSER_PROFILE_FLAG = '--user-data-dir='
export const BROWSER_BLANK_PAGE = 'about:blank'
// The fixed command line (spec §6.4): CDP over `--remote-debugging-pipe`
// (file descriptors 3 and 4), never a port; the proxy, the bypass list, the
// resolver rule and the auth sentinel; WebRTC UDP only through the proxy;
// QUIC off; no first-run, background, update, sync, default-app,
// reliability, ping or crash-report traffic; no keyring (the basic password
// store). Each must appear exactly once, byte for byte, in what the browser
// reports. No `--use-mock-keychain`: it means something on macOS only, where
// the pinned shell adds it itself (captured), so passing it too would double
// it.
export const BROWSER_LAUNCH_FLAGS: readonly string[] = [
  '--remote-debugging-pipe',
  '--enable-automation',
  `--proxy-bypass-list=${BROWSER_PROXY_BYPASS}`,
  `--host-resolver-rules=${BROWSER_HOST_RESOLVER_RULES}`,
  `--auth-server-allowlist=${BROWSER_AUTH_SENTINEL}`,
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--no-pings',
  '--disable-breakpad',
  '--disable-quic',
  '--password-store=basic',
  '--window-size=1280,800',
]
// Switches whose presence refuses a check, whatever their value (spec §6.4):
// another proxy or resolver, a debugging port, extensions, profiles, web
// security, certificates, ports, the sandbox, features and field trials,
// delegation and policy. Compared by name, lower-case, before any `=`.
export const BROWSER_FORBIDDEN_SWITCHES: readonly string[] = [
  'no-proxy-server',
  'proxy-pac-url',
  'proxy-auto-detect',
  'host-rules',
  'remote-debugging-port',
  'remote-debugging-address',
  'remote-allow-origins',
  'load-extension',
  'disable-extensions-except',
  'load-component-extension',
  'allowlisted-extension-id',
  'whitelisted-extension-id',
  'profile-directory',
  'disable-web-security',
  'unsafely-treat-insecure-origin-as-secure',
  'explicitly-allowed-ports',
  'no-sandbox',
  'disable-setuid-sandbox',
  'enable-features',
  'disable-features',
  'force-fieldtrials',
  'force-fieldtrial-params',
  'auth-negotiate-delegate-allowlist',
  'policy',
  'device-management-url',
  'flag-switches-begin',
  'flag-switches-end',
]
// Any switch named with this prefix refuses too (ignore-certificate-errors…).
export const BROWSER_FORBIDDEN_SWITCH_PREFIX = 'ignore-certificate-errors'
// The browser's product line at the pin: `HeadlessChrome/<version>`.
export const BROWSER_PRODUCT_PREFIX = 'HeadlessChrome/'
// Each check's folder under the extension's storage: `bc/<id>/` holding the
// profile (`p`), its temporary folder (`t`) and its home (`h`). Short names:
// Chrome's own sockets and locks live under them.
export const BROWSER_CHECK_DIR = 'bc'
export const BROWSER_CHECK_ID_BYTES = 4
export const BROWSER_PROFILE_SUBDIRS = { profile: 'p', temp: 't', home: 'h' } as const
// A leftover check folder is swept only when its owner process is gone, and
// at most this many per check (spec §6.3).
export const BROWSER_CHECK_OWNER_FILE = 'owner'
export const BROWSER_CHECK_SWEEP_MAX = 16
// The whole check, from start to screenshot; the page's load (a dev server
// with live reload may never finish loading: the check goes on with the
// page as it stands); and the wait after each click or type for a load it
// starts.
export const BROWSER_CHECK_TIMEOUT_MS = 60_000
export const BROWSER_CHECK_LOAD_TIMEOUT_MS = 15_000
export const BROWSER_CHECK_ACTION_SETTLE_MS = 1000
// How long the browser has to exit once asked, and again once killed; and
// the whole teardown (exit, listeners, profile removal, timers).
export const BROWSER_CHECK_CLOSE_GRACE_MS = 3000
export const BROWSER_CHECK_TEARDOWN_MS = 10_000
// A profile folder Windows still holds for a moment after the exit.
export const BROWSER_PROFILE_REMOVE_RETRIES = 5
export const BROWSER_PROFILE_REMOVE_RETRY_MS = 200
// What one call may ask: the URL, and up to this many click or type steps.
export const BROWSER_CHECK_URL_MAX_CHARS = 2048
export const BROWSER_CHECK_MAX_ACTIONS = 8
export const BROWSER_CHECK_SELECTOR_MAX_CHARS = 256
export const BROWSER_CHECK_TYPE_TEXT_MAX_CHARS = 1000
// What one check hands back: up to this many of each kind of entry (the
// rest are counted), each cut to this length.
export const BROWSER_CHECK_MAX_ENTRIES = 20
export const BROWSER_CHECK_ENTRY_MAX_CHARS = 500
// A CDP message larger than this ends the check (a screenshot is at most
// MAX_IMAGE_BYTES, about a third more as base64).
export const BROWSER_CHECK_MESSAGE_MAX_BYTES = 32 * MIB
// Random bytes (as hex) in the markers around what the page produced.
export const BROWSER_CHECK_MARKER_BYTES = 8
// The hosts `museSpark.browserCheckExtraHosts` may name: how many, how long.
export const BROWSER_CHECK_EXTRA_HOSTS_MAX = 32
export const BROWSER_CHECK_HOST_MAX_CHARS = 253
// The targets one check watches at once (the page, its frames and workers,
// and those they start); one past the bound ends the check unwatchable.
export const BROWSER_CHECK_MAX_TARGETS = 64
// The target types a check lets run once watched; any other is unwatchable.
export const BROWSER_CHECK_TARGET_TYPES: readonly string[] = [
  'page',
  'iframe',
  'worker',
  'shared_worker',
  'service_worker',
]
// The page and frame types that get the virtual authenticator and the file
// chooser interception before they run.
export const BROWSER_CHECK_DOCUMENT_TYPES: readonly string[] = ['page', 'iframe']
// The requests in flight whose URLs one check keeps (to name a request that
// fails); past the bound the oldest is forgotten. Each URL is cut to
// BROWSER_CHECK_ENTRY_MAX_CHARS.
export const BROWSER_CHECK_MAX_TRACKED_REQUESTS = 512
// The owned proxy (spec §3.2): one per check on 127.0.0.1 at a port the OS
// picks; request and response heads at most 16 KiB, a request head within
// 3 s, at most 64 connections, and at most this many observations kept.
export const BROWSER_PROXY_HOST = '127.0.0.1'
// A request whose answer has this status or more is listed as failed.
export const BROWSER_FAILED_STATUS = 400
export const BROWSER_PROXY_HEAD_MAX_BYTES = 16 * 1024
export const BROWSER_PROXY_HEAD_TIMEOUT_MS = 3000
export const BROWSER_PROXY_CHECK_INTERVAL_MS = 250
export const BROWSER_PROXY_MAX_CONNECTIONS = 64
export const BROWSER_PROXY_MAX_OBSERVATIONS = 1024
// `localhost` as the proxy connects to it: these literals, in order, never
// the system resolver.
export const BROWSER_LOCALHOST_ADDRESSES: readonly string[] = ['127.0.0.1', '::1']
// The canaries (spec §6.2, §7): fresh 128-bit nonces per phase, at most 8 s
// per phase, 15 s for the default and page phases together, 8 s for the
// audit; how long the page's own probe script waits for its sockets.
export const BROWSER_CANARY_NONCE_BYTES = 16
export const BROWSER_CANARY_PHASE_MS = 8000
export const BROWSER_CANARY_INITIAL_MS = 15_000
export const BROWSER_CANARY_SOCKET_WAIT_MS = 3000
// After the probe page's script: how long its last proxy records may take to land.
export const BROWSER_CANARY_SETTLE_MS = 1000
// The link-local address a canary asks for: never contacted, the proxy
// refuses it. Asked for at the phase's own fixture port, so its refusal is
// that phase's alone.
export const BROWSER_CANARY_LINK_LOCAL = '169.254.77.77'
// The network service's process type in SystemInfo.getProcessInfo at the
// pin: a new id during the check is a restart.
export const BROWSER_NETWORK_SERVICE_TYPE = 'network.mojom.NetworkService'
// The page's error text that crosses the boundary (browserRun.ts).
export const BROWSER_NET_ERROR = /^net::ERR_[A-Z0-9_]+$/
// The runtime's preparation (spec §4.1): consent, the download and the
// verification have their own cancellable lifetime, before the check's 60
// seconds start; each stage has its own bound inside it, and its cleanup
// 10 s.
export const BROWSER_RUNTIME_PREPARATION_MS = 15 * 60_000
export const BROWSER_RUNTIME_CONSENT_MS = 2 * 60_000
export const BROWSER_RUNTIME_TRANSFER_MS = 10 * 60_000
export const BROWSER_RUNTIME_VERIFY_MS = 3 * 60_000
export const BROWSER_RUNTIME_CLEANUP_MS = 10_000
// Freshness (spec §4.2): a day in exact milliseconds; checks refuse at 45
// days after the pin's publication; release and weekly CI fail when the
// newest Stable is more than 14 days newer.
export const BROWSER_RUNTIME_DAY_MS = 86_400_000
export const BROWSER_RUNTIME_EXPIRY_DAYS = 45
export const BROWSER_RUNTIME_LAG_DAYS = 14
// The store (spec §4.3, §4.4): <globalStorage>/browser-runtime/<version>/
// <platform>/, staged in a unique sibling, its receipt inside.
export const BROWSER_RUNTIME_DIR = 'browser-runtime'
export const BROWSER_RUNTIME_STAGE_PREFIX = '.stage-'
export const BROWSER_RUNTIME_STAGE_RANDOM_BYTES = 16
export const BROWSER_RUNTIME_ARCHIVE_PART = 'archive.part'
export const BROWSER_RUNTIME_UNPACK_DIR = 'unpack'
export const BROWSER_RUNTIME_RECEIPT = '.muse-receipt.json'
// The download: the transfer may exceed the pinned length by 1% before it is
// cut; at most this many redirects, each within the pinned origin and path.
export const BROWSER_RUNTIME_TRANSFER_SLACK = 1.01
export const BROWSER_RUNTIME_MAX_REDIRECTS = 3
// The ZIP reader's bounds (spec §4.3): entries, a name's length, every
// output byte (400 MiB in all), the end-of-central-directory search.
export const BROWSER_RUNTIME_MAX_ENTRIES = 1024
export const BROWSER_RUNTIME_MAX_NAME_BYTES = 255
export const BROWSER_RUNTIME_MAX_EXTRACTED_BYTES = 400 * MIB
export const BROWSER_RUNTIME_EOCD_SEARCH_BYTES = 65_557
// Windows' own tree kill, by its path under SystemRoot: the shell's job
// fallback (processTree.ts, M27) and the browser check's kill.
export const WINDOWS_TASKKILL_RELATIVE_PATH = String.raw`System32\taskkill.exe`
