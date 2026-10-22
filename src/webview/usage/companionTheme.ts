// M114 C: the companion page's theme and appearance wiring.
//
// The companion has no editor host, so its ThemePort carries an empty role
// map: the four Muse palettes show through, and the mode follows the
// operating system until an appearance choice is stored. Font preferences
// ride F's ports: a localStorage FontPreferencesPort feeds F's schema, and
// a nonce-carrying <style> element is the FontTokenPort (inline style
// writes are refused under the page policy). Invalid stored data falls
// back to the operating system and the token stacks; it is never applied
// half-parsed.
import { COMPANION_APPEARANCE_STORAGE_KEY } from '../../shared/constants'
import {
  applyFontPreferences,
  fontPreferencesSchema,
  type FontPreferences,
  type FontPreferencesPort,
  type FontTokenPort,
} from '../../runtime/fonts/preferences'
import type { ThemePort } from '../bridges/theme/themeBridge'

const MODES = ['light', 'dark', 'hc-light', 'hc-dark'] as const
export type CompanionThemeMode = (typeof MODES)[number]

function isMode(value: unknown): value is CompanionThemeMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAborted(signal: AbortSignal): boolean {
  // Read through a call: the flag changes asynchronously and the compiler
  // cannot narrow it across the awaits below.
  return signal.aborted
}

/** The companion's storage, or undefined where the browser refuses it. */
export function companionStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return globalThis.localStorage
  } catch (error: unknown) {
    // A refused store reads absent; the page follows the operating system
    // and the token stacks. Anything else is a caller bug that must surface.
    if (!(error instanceof DOMException)) throw error
    return undefined
  }
}

function readStoredJson(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch (error: unknown) {
    // A refused read has no record; the documented defaults apply.
    if (!(error instanceof DOMException)) throw error
    return undefined
  }
  try {
    return raw === null ? undefined : (JSON.parse(raw) as unknown)
  } catch (error: unknown) {
    // Corrupt storage reads as absent; the documented defaults apply.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

/** F's storage port over the companion's localStorage record. */
export function companionPreferencesPort(storage: Pick<Storage, 'getItem' | 'setItem'>): {
  readonly port: FontPreferencesPort
  readonly storedMode: CompanionThemeMode | undefined
} {
  const stored = readStoredJson(storage, COMPANION_APPEARANCE_STORAGE_KEY)
  const record = isStringRecord(stored) ? stored : undefined
  const mode = record?.['mode']
  const readRecord = (): unknown => {
    if (record === undefined) return {}
    // fontPreferencesSchema is strict: only its own keys cross.
    const { ui, code, ligatures } = record
    return { ui, code, ligatures }
  }
  return {
    port: {
      read: () => Promise.resolve(readRecord()),
      write: (preferences: FontPreferences): Promise<void> => {
        // A synchronous store throws synchronously; the async settings
        // binder awaiting this still surfaces it as a rejection.
        storage.setItem(
          COMPANION_APPEARANCE_STORAGE_KEY,
          JSON.stringify({ ...record, ...preferences }),
        )
        return Promise.resolve()
      },
    },
    storedMode: isMode(mode) ? mode : undefined,
  }
}

/** F's token port over a bridge-style nonce-carrying <style> element. */
export function companionFontTokenPort(
  document: Document,
  nonce: string,
  fallbacks: { readonly ui: string; readonly code: string },
): FontTokenPort & { readonly dispose: () => void } {
  const element = document.createElement('style')
  element.dataset['msCompanionFonts'] = ''
  element.setAttribute('nonce', nonce)
  const declarations = new Map<string, string>()
  const tokens: FontTokenPort = {
    uiFallback: fallbacks.ui,
    codeFallback: fallbacks.code,
    setProperty(name, value) {
      declarations.set(name, value)
      element.textContent = `:root{${[...declarations].map(([key, item]) => `${key}:${item}`).join(';')}}`
    },
  }
  document.head.append(element)
  if (element.sheet === null) {
    // A strict page policy refused the element: remove it and report,
    // instead of leaving font preferences silently unapplied.
    element.remove()
    throw new Error('EPANEL_THEME')
  }
  return {
    ...tokens,
    dispose: () => {
      element.remove()
    },
  }
}

export interface CompanionThemeSystem {
  /** The operating system's dark preference at load time. */
  readonly isDark: boolean
  /** Calls back on operating-system theme changes; returns its unsubscribe. */
  readonly onChange: (receive: (isDark: boolean) => void) => () => void
}

function systemTheme(system: CompanionThemeSystem | undefined): CompanionThemeSystem {
  if (system !== undefined) return system
  const media =
    typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia('(prefers-color-scheme: dark)')
      : undefined
  if (media === undefined) {
    const unsubscribe = (): void => {
      // No operating-system theme source to unsubscribe from.
    }
    return { isDark: false, onChange: () => unsubscribe }
  }
  return {
    isDark: media.matches,
    onChange: (receive) => {
      const listener = (event: MediaQueryListEvent) => {
        receive(event.matches)
      }
      media.addEventListener('change', listener)
      return () => {
        media.removeEventListener('change', listener)
      }
    },
  }
}

/** The companion's internal port: empty roles select the Muse palettes. */
export function companionThemePort(initial: CompanionThemeMode): ThemePort & {
  readonly update: (mode: CompanionThemeMode) => void
} {
  let current: unknown = { mode: initial, roles: {} }
  const receivers = new Set<(snapshot: unknown) => void>()
  return {
    current: () => current,
    subscribe: (receive) => {
      receivers.add(receive)
      return () => {
        receivers.delete(receive)
      }
    },
    update: (mode) => {
      current = { mode, roles: {} }
      for (const receive of receivers) receive(current)
    },
  }
}

/** A computed token stack, or the generated fallback when it is missing. */
function stack(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

export interface CompanionThemeInput {
  readonly root: HTMLElement
  /** The page's style nonce, read from the served document. */
  readonly nonce: string
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  readonly system?: CompanionThemeSystem | undefined
  readonly signal: AbortSignal
}

/**
Mount the lazy theme consumer with the companion's appearance. Resolves to
the disposer; resolves undefined when the signal cancels the load; throws
EPANEL_THEME when the theme cannot be installed. The caller renders
unthemed on a refused install: the generated token defaults still paint a
complete page.
*/
export async function loadCompanionTheme(
  input: CompanionThemeInput,
): Promise<(() => void) | undefined> {
  const seen = input.storage === undefined ? undefined : companionPreferencesPort(input.storage)
  const system = systemTheme(input.system)
  const theme = companionThemePort(seen?.storedMode ?? (system.isDark ? 'dark' : 'light'))
  const stopSystem =
    seen?.storedMode === undefined
      ? system.onChange((isDark) => {
          theme.update(isDark ? 'dark' : 'light')
        })
      : () => {
          // A stored mode ignores the operating system; nothing to stop.
        }
  try {
    // The schema default must parse: a throw here is a code bug and reads
    // unthemed through the caller. Stored data may be invalid, so it parses
    // safe and falls back to the token stacks.
    let preferences = fontPreferencesSchema.parse({})
    if (seen !== undefined) {
      const parsed = fontPreferencesSchema.safeParse(await seen.port.read())
      if (parsed.success) preferences = parsed.data
    }
    const computed = input.root.ownerDocument.defaultView?.getComputedStyle(
      input.root.ownerDocument.documentElement,
    )
    // The generated stacks are the fallback until a later lane changes them;
    // companionTheme.test.ts pins these against design/tokens/generated/muse.css.
    const tokens = companionFontTokenPort(input.root.ownerDocument, input.nonce, {
      ui: stack(computed?.getPropertyValue('--ms-font-ui'), "inter, 'Segoe UI', sans-serif"),
      code: stack(
        computed?.getPropertyValue('--ms-font-code'),
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      ),
    })
    try {
      applyFontPreferences(preferences, 'standalone', tokens)
      // The CSS-free consumer only: the page links the theme's emitted
      // sheets as static files (see renderCompanionPage), so no stylesheet
      // rides the JavaScript chunk into the entry CSS. The abort discipline
      // mirrors loadThemeBridge, which owns the bundled entry instead.
      const { mountThemeBridge } = await import('../bridges/theme/themeBridge')
      if (isAborted(input.signal)) {
        tokens.dispose()
        stopSystem()
        return undefined
      }
      let stop: (() => void) | undefined
      const stopSignal = () => {
        stopSystem()
        tokens.dispose()
        stop?.()
      }
      input.signal.addEventListener('abort', stopSignal, { once: true })
      try {
        // The companion's snapshots are always valid; an invalid report
        // means the page policy refused the owned element, which throws
        // through the bridge's own disposal instead of half-applying.
        stop = mountThemeBridge(
          input.root,
          theme,
          () => {
            throw new Error('EPANEL_THEME')
          },
          { nonce: input.nonce },
        )
      } catch (error) {
        input.signal.removeEventListener('abort', stopSignal)
        throw error
      }
      // The initial snapshot may have run before the listener was installed.
      if (isAborted(input.signal)) {
        input.signal.removeEventListener('abort', stopSignal)
        stop()
        tokens.dispose()
        stopSystem()
        return undefined
      }
      return () => {
        input.signal.removeEventListener('abort', stopSignal)
        stopSystem()
        tokens.dispose()
        stop()
      }
    } catch (error) {
      tokens.dispose()
      throw error
    }
  } catch (error) {
    stopSystem()
    throw error
  }
}
