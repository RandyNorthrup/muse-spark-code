// Desktop harness scenes (M111 lane QA): one scene per approved mockup
// sheet (docs/design/m111-mockups/), rendered from lane 0's contracts, the
// generated M114 tokens and the real desktop string group in the requested
// language. A scene is a harness shell for the token, language and geometry
// plumbing until the shell lanes (SH1, SH2, WB) replace its content with the
// real surface under the same id; the corner annotation says so on every
// shot, and no test reads product behaviour from a scene.

import { loadDesktopContracts } from './contracts.mjs'
import { desktopStrings, desktopText } from './strings.mjs'

export const DESKTOP_THEMES = ['dark', 'light', 'hc-dark', 'hc-light']
export const TOKENS_PATH = 'design/tokens/generated/muse.css'
export const SCENES_CSS_PATH = 'test/desktop/harness/scenes.css'
export const SCENE_PREFIX = '/desktop-scene/'
export const SCENE_READY = '[data-desktop-scene-ready]'

const ANNOTATION = 'M111 QA scene shell · not product UI'

export const DESKTOP_SCENES = [
  { id: 'workbench-1920', sheet: '01-03 · Workbench 1920×1080', width: 1920, height: 1080 },
  { id: 'workbench-1280', sheet: '04-06 · Workbench 1280×800', width: 1280, height: 800 },
  { id: 'bar-popovers', sheet: '07-08 · Top bar popovers', width: 1440, height: 900 },
  { id: 'launcher', sheet: '09-10 · Launcher', width: 1440, height: 900 },
  { id: 'greeter', sheet: '11 · Greeter', width: 1440, height: 900 },
  { id: 'lock', sheet: '12 · Lock screen', width: 1440, height: 900 },
  { id: 'prompts', sheet: '13 · System prompts', width: 1440, height: 900 },
  { id: 'tiled', sheet: '14 · Tiled desktop', width: 1920, height: 1080 },
  { id: 'onboarding', sheet: '15 · Onboarding', width: 1440, height: 900 },
  { id: 'preview-grid', sheet: '16-17 · Preview grid', width: 1920, height: 1080 },
  { id: 'rtl', sheet: '18 · Pseudo-RTL mirror', width: 1440, height: 900 },
]

const SCENE_BY_ID = new Map(DESKTOP_SCENES.map((scene) => [scene.id, scene]))

/** The scene named `id`, or a thrown list of the scenes there are. */
export function desktopScene(id) {
  const scene = SCENE_BY_ID.get(id)
  if (scene === undefined) {
    throw new Error(
      `unknown desktop scene ${String(id)}; known: ${DESKTOP_SCENES.map((each) => each.id).join(', ')}`,
    )
  }
  return scene
}

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function topBar(contracts, text) {
  const items = contracts.BAR_POPOVERS.map(
    (name) => `<span class="ds-bar-item" data-popover="${name}">${escapeHtml(name)}</span>`,
  ).join('')
  return `<header class="ds-bar" data-region="top-bar"><span class="ds-brand">${escapeHtml(text('greeterTitle'))}</span><nav class="ds-bar-items">${items}</nav></header>`
}

function statusBar(text) {
  return `<footer class="ds-status" data-region="status-bar"><span>${escapeHtml(text('agentsRunning', { count: 2 }))}</span></footer>`
}

function workbench(contracts, text, compact) {
  const panes = contracts.COMPACT_PANES
  const sizes = compact
    ? { chat: panes.chatWidthPx, sidebar: panes.sidebarWidthPx, panel: panes.terminalHeightPx }
    : { chat: 420, sidebar: 320, panel: 240 }
  const style = ` style="grid-template-columns:${sizes.chat}px 1fr ${sizes.sidebar}px ${contracts.DESKTOP_FRAME.railWidthPx}px;grid-template-rows:1fr ${sizes.panel}px"`
  const regions = contracts.WORKBENCH_REGIONS.filter(
    (region) => region !== 'top-bar' && region !== 'status-bar',
  )
    .map(
      (region) =>
        `<section class="ds-region ds-region-${region}" data-region="${region}"><span class="ds-region-name">${region}</span></section>`,
    )
    .join('')
  return `${topBar(contracts, text)}<main class="ds-workbench${compact ? ' ds-compact' : ''}"${style}>${regions}</main>${statusBar(text)}`
}

function barPopovers(contracts, text) {
  const cards = contracts.BAR_POPOVERS.map(
    (name) =>
      `<section class="ds-card" data-popover="${name}"><h2>${escapeHtml(name)}</h2></section>`,
  ).join('')
  return `${topBar(contracts, text)}<main class="ds-cards">${cards}</main>${statusBar(text)}`
}

function launcher(contracts, text) {
  const kinds = contracts.LAUNCHER_RESULT_KINDS.map((kind) =>
    contracts.launcherResultSchema.parse({ kind, id: `scene-${kind}`, title: kind }),
  )
    .map(
      (result) =>
        `<li data-kind="${result.kind}"><span class="ds-kind">${escapeHtml(result.kind)}</span> ${escapeHtml(result.title)}</li>`,
    )
    .join('')
  const modes = contracts.LAUNCHER_MODES.map(
    (mode) => `<span class="ds-chip" data-mode="${mode}">${escapeHtml(mode)}</span>`,
  ).join('')
  return `<main class="ds-centre"><section class="ds-launcher" role="dialog" aria-label="launcher"><div class="ds-modes">${modes}</div><ul class="ds-results">${kinds}</ul><p class="ds-note">${escapeHtml(text('launcherCalculateLocal'))}</p><p class="ds-note">${escapeHtml(text('launcherSymbolSearch'))}</p></section></main>`
}

const FACTOR_KEYS = {
  password: 'password',
  pin: 'pin',
  'security-key': 'securityKey',
  fingerprint: 'fingerprint',
}

function greeter(contracts, text) {
  const factors = contracts.AUTH_FACTORS.map((factor) => {
    const key = FACTOR_KEYS[factor] ?? factor
    return `<button type="button" data-factor="${factor}">${escapeHtml(text(key))}</button>`
  }).join('')
  return `<main class="ds-centre"><section class="ds-greeter"><h1>${escapeHtml(text('greeterTitle'))}</h1><label>${escapeHtml(text('password'))} <input type="password" autocomplete="off"></label><p>${escapeHtml(text('orSignInWith'))}</p><div class="ds-factors">${factors}</div><p>${escapeHtml(text('session'))}: ${escapeHtml(text('sessionDesktop'))} · ${escapeHtml(text('sessionTerminal'))}</p><p>${escapeHtml(text('accessibility'))} · ${escapeHtml(text('recovery'))} — ${escapeHtml(text('recoveryHint'))}</p><p class="ds-secure">${escapeHtml(text('secureAttentionGreeter'))}</p></section></main>`
}

const LOCK_ACTION_KEYS = {
  'stop-everything': 'stopEverything',
  'lock-admin': 'lockAdmin',
  'stop-machine': 'stopMachine',
}

function lock(contracts, text) {
  const actions = contracts.LOCK_ACTIONS.map((action) => {
    const key = LOCK_ACTION_KEYS[action] ?? action
    return `<button type="button" data-action="${action}">${escapeHtml(text(key))}</button>`
  }).join('')
  return `<main class="ds-centre"><section class="ds-lock"><h1>${escapeHtml(text('greeterTitle'))}</h1><p data-count>${escapeHtml(text('notificationsCount', { count: 3 }))}</p><p>${escapeHtml(text('agentsRunning', { count: 1 }))}</p><p>${escapeHtml(text('worksWithoutSignIn'))}</p><div class="ds-factors">${actions}</div><p class="ds-secure">${escapeHtml(text('secureAttentionLock'))}</p></section></main>`
}

const PROMPT_KEYS = {
  'administrator-password': 'administratorPassword',
  'agent-admin': 'agentAdminRequest',
  'wifi-password': 'wifiPassword',
  'bluetooth-pairing': 'bluetoothPairing',
}

function prompts(contracts, text) {
  const kinds = contracts.SYSTEM_PROMPT_KINDS.map((kind) => {
    const title = text(PROMPT_KEYS[kind] ?? kind)
    return `<section class="ds-card" data-prompt="${kind}"><h2>${escapeHtml(title)}</h2><p class="ds-secure">${escapeHtml(text('secureAttentionPrompt'))}</p><div class="ds-factors"><button type="button">${escapeHtml(text('deny'))}</button><button type="button">${escapeHtml(text('allowOnce'))}</button></div></section>`
  }).join('')
  return `<main class="ds-cards">${kinds}</main>`
}

function tiled(contracts, text) {
  const windows = ['workbench', 'terminal (floating)', 'preview']
    .map(
      (name, index) =>
        `<section class="ds-window${index === 0 ? ' ds-focused' : ''}" data-window="${index}"><span class="ds-region-name">${escapeHtml(name)}</span></section>`,
    )
    .join('')
  return `${topBar(contracts, text)}<main class="ds-tiled" data-detached-terminal="${contracts.TILING.detachedTerminal}">${windows}</main>${statusBar(text)}`
}

function onboarding(contracts, text) {
  const pack = contracts.onboardingPackSchema.parse({
    id: 'web',
    name: 'Web development',
    version: '1.0.0',
    downloadBytes: 704_000_000,
    diskBytes: 2_100_000_000,
    licences: ['MIT'],
    recommended: true,
  })
  return `<main class="ds-centre"><section class="ds-onboarding"><h1>${escapeHtml(text('onboardingTitle'))}</h1><p>${escapeHtml(text('onboardingStep', { step: 2, total: 4 }))}</p><h2>${escapeHtml(text('packsForYourWork'))}</h2><p>${escapeHtml(text('fromSignedIndex'))}</p><article class="ds-pack" data-pack="${pack.id}"><h3>${escapeHtml(pack.name)} ${escapeHtml(pack.version)}</h3><p>${escapeHtml(text('downloadSize'))}: ${pack.downloadBytes} · ${escapeHtml(text('onDiskSize'))}: ${pack.diskBytes} · ${escapeHtml(pack.licences.join(', '))}</p></article><div class="ds-factors"><button type="button">${escapeHtml(text('setUpLater'))}</button><button type="button">${escapeHtml(text('back'))}</button><button type="button">${escapeHtml(text('install'))}</button></div></section></main>`
}

function previewGrid(contracts, text) {
  const devices = contracts.PREVIEW_DEVICES.map((device) => {
    const viewport = contracts.previewViewportSchema.parse({
      deviceId: device.id,
      widthPx: device.widthPx,
      heightPx: device.heightPx,
    })
    const scale = 320 / viewport.widthPx
    const height = Math.round(viewport.heightPx * scale)
    return `<figure class="ds-device" data-device="${viewport.deviceId}"><div class="ds-viewport" style="width:320px;height:${height}px"></div><figcaption>${viewport.deviceId} · ${viewport.widthPx}×${viewport.heightPx}</figcaption></figure>`
  }).join('')
  return `${topBar(contracts, text)}<main class="ds-devices">${devices}</main>${statusBar(text)}`
}

function rtl(contracts, text) {
  const ltr = contracts.RTL_LTR_ONLY.map(
    (kind) =>
      `<p class="ds-ltr" dir="ltr" data-ltr-kind="${kind}" data-mirrored="${String(contracts.isMirroredInRtl(kind))}">${escapeHtml(kind)}: left-to-right</p>`,
  ).join('')
  return `<main class="ds-centre"><section class="ds-rtl"><h1 data-mirrored="${String(contracts.isMirroredInRtl('ui-string'))}">${escapeHtml(text('greeterTitle'))}</h1><p>${escapeHtml(text('session'))}: ${escapeHtml(text('sessionDesktop'))}</p>${ltr}</section></main>`
}

const BUILDERS = {
  'workbench-1920': (contracts, text) => workbench(contracts, text, false),
  'workbench-1280': (contracts, text) => workbench(contracts, text, true),
  'bar-popovers': barPopovers,
  launcher,
  greeter,
  lock,
  prompts,
  tiled,
  onboarding,
  'preview-grid': previewGrid,
  rtl,
}

/** The full HTML of one scene in one theme and language. */
export async function desktopSceneHtml(repoRoot, { scene: id, theme = 'dark', lang = 'en' }) {
  if (!DESKTOP_THEMES.includes(theme)) {
    throw new Error(`unknown desktop theme ${theme}; known: ${DESKTOP_THEMES.join(', ')}`)
  }
  const scene = desktopScene(id)
  const [contracts, table] = await Promise.all([
    loadDesktopContracts(repoRoot),
    desktopStrings(repoRoot, lang),
  ])
  const text = (key, slots) => desktopText(table, lang, key, slots)
  const body = BUILDERS[scene.id](contracts, text)
  const dir = scene.id === 'rtl' ? 'rtl' : 'ltr'
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${dir}" data-ms-theme="${theme}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(scene.id)} · ${escapeHtml(scene.sheet)}</title>
<link rel="stylesheet" href="/${TOKENS_PATH}">
<link rel="stylesheet" href="/${SCENES_CSS_PATH}">
</head>
<body data-desktop-scene="${scene.id}" data-desktop-scene-ready>
${body}
<footer class="ds-annotation">${ANNOTATION} · ${escapeHtml(scene.sheet)} · theme=${theme} · lang=${escapeHtml(lang)}</footer>
</body>
</html>
`
}

/** The `/desktop-scene/<id>?theme=&lang=` path a harness server route matches. */
export function parseSceneRequest(url) {
  if (!url.pathname.startsWith(SCENE_PREFIX)) return undefined
  const id = decodeURIComponent(url.pathname.slice(SCENE_PREFIX.length))
  return {
    scene: id,
    theme: url.searchParams.get('theme') ?? 'dark',
    lang: url.searchParams.get('lang') ?? 'en',
  }
}
