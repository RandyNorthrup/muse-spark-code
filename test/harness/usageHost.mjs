import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { parseUsagePageToServiceMessage } from '../../src/shared/usagePage'
import { usageStateFor } from '../unit/helpers/usageFixtures'

const view = globalThis.window
const page = globalThis.document
const params = new globalThis.URLSearchParams(globalThis.location.search)
const kind = params.get('bridge') ?? 'vscode'
const scenario = params.get('scenario') ?? 'one-provider'
const messages = new globalThis.EventTarget()
const posted = []
const errors = []
view.usageHarness = { posted, errors }
view.usageHarness.failNextSend = () => {
  current.shouldFailNextSend = true
}
const current = { state: usageStateFor(scenario), saved: undefined, shouldFailNextSend: false }
// M107 W-history scenes: real-shaped history, an unreadable journal, an empty one.
const resourceScene = params.get('resources')
if (resourceScene !== null) current.state.resources = resourceHistoryScene(resourceScene)

function resourceHistoryScene(name) {
  if (name === 'unavailable') return null
  if (name === 'empty') return { minutes: [], events: [], counts: [], work: [] }
  const now = current.state.generatedAt
  const minuteMs = 60_000
  const start = Math.floor(now / minuteMs) * minuteMs - 89 * minuteMs
  const minutes = Array.from({ length: 90 }, (_, index) => ({
    type: 'resource',
    atMs: start + index * minuteMs + 1000,
    event: null,
    minute: {
      cpuPercent: index === 30 ? null : 35 + ((index * 7) % 55),
      memoryUsedPercent: 52 + ((index * 3) % 40),
      availableMemory: index > 70 ? 'low' : 'ample',
      gpuPercent: null,
      diskBusyPercent: null,
      level: index > 60 && index < 75 ? 'throttle' : 'normal',
      thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
    },
    work: [{ kind: 'check', cpuSeconds: index % 5, peakMemoryBytes: 300_000_000 }],
  }))
  const changed = start + 61 * minuteMs
  return {
    minutes,
    events: [
      { type: 'levelChanged', atMs: changed, from: 'normal', to: 'throttle', reason: 'cpu' },
      { type: 'deferred', atMs: changed + 5000, kind: 'check', class: 'background' },
      {
        type: 'levelChanged',
        atMs: start + 75 * minuteMs,
        from: 'throttle',
        to: 'normal',
        reason: 'recovery',
      },
    ],
    counts: [
      { type: 'levelChanged', kind: null, count: 2 },
      { type: 'deferred', kind: 'check', count: 1 },
    ],
    work: [{ kind: 'check', cpuSeconds: 180, peakMemoryBytes: 300_000_000 }],
    days: [8, 9, 10].map((back) => ({
      day: new Date(now - back * 86_400_000).toISOString().slice(0, 10),
      minutes: 1400 - back * 10,
      cpuPercent: 30 + back,
      memoryUsedPercent: 60 + back,
      levels: { normal: 1300, throttle: 90 - back * 5, relocate: 0, pause: 10 },
      events: 12 + back,
      work: [{ kind: 'check', cpuSeconds: 900 + back, peakMemoryBytes: 400_000_000 }],
    })),
  }
}
view.usageHarness.addAccount = () => {
  current.state.limits.push({
    ...current.state.limits[0],
    id: 'account-check',
    provider: 'openrouter',
    backend: 'modelApi',
    source: 'openRouter',
    windows: [],
    account: { usedUsd: 9, limitUsd: 10, remainingUsd: 1, period: 'monthly' },
  })
}
const language = { 'long-german': 'de', 'long-russian': 'ru' }[scenario] ?? 'en'
const translated = {
  de: {
    title: 'Nutzung und Kosten',
    subtitle: 'Modellaufrufe in Ihren Editoren auf diesem Computer.',
    groupBy: 'Gruppieren nach',
    refresh: 'Aktualisieren',
    deleteHistory: 'Nutzungsverlauf löschen…',
  },
  ru: {
    title: 'Использование и стоимость',
    subtitle: 'Вызовы моделей во всех редакторах на этом компьютере.',
    groupBy: 'Группировать по',
    refresh: 'Обновить',
    deleteHistory: 'Удалить историю использования…',
  },
}
const table = {
  ...USAGE_EN,
  ...translated[language],
}
const embedded = page.createElement('script')
embedded.id = 'muse-usage-l10n'
embedded.type = 'application/json'
embedded.textContent = JSON.stringify({ type: 'usage/table', locale: language, table })
page.head.append(embedded)
page.body.dataset.hostBridge = kind

function answer(input) {
  const parsed = parseUsagePageToServiceMessage(input)
  if (!parsed.ok) throw new Error('Harness received invalid usage request')
  const message = parsed.message
  posted.push(message)
  switch (message.type) {
    case 'usage/query': {
      current.state = { ...current.state, query: message.query }
      break
    }
    case 'usage/setHistory': {
      current.state = {
        ...current.state,
        history: { ...current.state.history, enabled: message.enabled },
      }
      break
    }
    case 'usage/export': {
      return {
        type: 'usage/result',
        requestId: message.requestId,
        action: 'export',
        outcome: 'completed',
      }
    }
    case 'usage/deleteHistory': {
      return {
        type: 'usage/result',
        requestId: message.requestId,
        action: 'deleteHistory',
        outcome: 'cancelled',
      }
    }
    case 'usage/modelDetail': {
      current.state = {
        ...current.state,
        modelDetail: {
          provider: message.provider,
          model: message.model,
          totals: current.state.totals,
          trend: current.state.buckets,
          pricedLater: false,
        },
      }
      break
    }
    default: {
      break
    }
  }
  return { type: 'usage/state', state: current.state }
}
function sendNative(input) {
  if (current.shouldFailNextSend) {
    current.shouldFailNextSend = false
    throw new Error('Private native transport detail')
  }
  const data = answer(typeof input === 'string' ? JSON.parse(input) : input)
  globalThis.queueMicrotask(() => {
    messages.dispatchEvent(
      new globalThis.MessageEvent('message', {
        data: kind === 'jcef' || kind === 'swt' ? JSON.stringify(data) : data,
      }),
    )
  })
}
const persistence = {
  savedState: () => current.saved,
  saveState: (next) => {
    current.saved = next
  },
}
view.museUsageHostPorts = {
  jcef: { ...persistence, messages, send: sendNative },
  swt: { ...persistence, messages, send: sendNative },
  webView2: { ...persistence, messages, postMessage: sendNative },
  http: { ...persistence, request: async (request) => answer(request) },
}
view.acquireVsCodeApi = () => ({
  getState: persistence.savedState,
  setState: persistence.saveState,
  postMessage: (message) => {
    const data = answer(message)
    globalThis.queueMicrotask(() => {
      view.dispatchEvent(new globalThis.MessageEvent('message', { data }))
    })
  },
})
const theme = params.get('theme')
if (theme !== null) {
  const response = await fetch(`themes/${theme}.json`)
  if (!response.ok) throw new Error('Cannot read theme capture')
  const capture = await response.json()
  for (const [key, value] of Object.entries(capture.variables))
    page.documentElement.style.setProperty(key, value)
  for (const key of capture.unset) {
    if (!key.includes('font')) page.documentElement.style.setProperty(key, 'initial')
  }
  page.body.classList.add(...capture.bodyClass.split(' '))
}
view.addEventListener('error', (event) => {
  errors.push(event.message)
})
view.addEventListener('unhandledrejection', () => {
  errors.push('Unhandled rejection')
})
const product = page.createElement('script')
product.type = 'module'
product.src = '../../dist/webview/usage.js'
page.head.append(product)
