// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPANION_APPEARANCE_STORAGE_KEY } from '../../src/shared/constants'
import { fontPreferencesSchema } from '../../src/runtime/fonts/preferences'
import {
  companionPreferencesPort,
  companionStorage,
  companionThemePort,
  loadCompanionTheme,
  type CompanionThemeSystem,
} from '../../src/webview/usage/companionTheme'

function storedAppearance(value: unknown): void {
  globalThis.localStorage.setItem(COMPANION_APPEARANCE_STORAGE_KEY, JSON.stringify(value))
}

function system(isDark: boolean): {
  system: CompanionThemeSystem
  emit: (isDark: boolean) => void
} {
  const listeners = new Set<(isDark: boolean) => void>()
  return {
    system: {
      isDark,
      onChange: (receive) => {
        listeners.add(receive)
        return () => {
          listeners.delete(receive)
        }
      },
    },
    emit: (isDark: boolean) => {
      for (const receive of listeners) receive(isDark)
    },
  }
}

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
  globalThis.localStorage.clear()
  delete document.documentElement.dataset['msTheme']
  for (const owned of document.head.querySelectorAll(
    'style[data-ms-theme-vars], style[data-ms-companion-fonts], style[data-test-sheets]',
  ))
    owned.remove()
})

/** Mount with the real store; throws when the theme does not install. */
async function mount(
  nonce: string,
  input: Partial<Parameters<typeof loadCompanionTheme>[0]> = {},
): Promise<() => void> {
  const dispose = await loadCompanionTheme({
    root: document.documentElement,
    nonce,
    storage: companionStorage(),
    system: system(false).system,
    signal: new AbortController().signal,
    ...input,
  })
  if (dispose === undefined) throw new Error('theme did not mount')
  disposers.push(dispose)
  return dispose
}

describe('companion appearance storage', () => {
  it('exposes the live store, or nothing where the browser refuses it', () => {
    const storage = companionStorage()
    expect(storage).toBe(globalThis.localStorage)
    storage?.setItem(COMPANION_APPEARANCE_STORAGE_KEY, JSON.stringify({ mode: 'dark' }))
    expect(globalThis.localStorage.getItem(COMPANION_APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify({ mode: 'dark' }),
    )
  })
  it('reads no record as absent, following the operating system', () => {
    const storage = companionStorage()
    expect(storage).toBeDefined()
    if (storage === undefined) throw new Error('storage refused')
    const { storedMode, port } = companionPreferencesPort(storage)
    expect(storedMode).toBeUndefined()
    return expect(port.read()).resolves.toEqual({})
  })
  it('keeps a stored mode and drops unknown font keys before the strict schema', async () => {
    storedAppearance({
      mode: 'hc-dark',
      ui: 'system',
      code: 'Fira Code',
      ligatures: true,
      injected: 'x',
    })
    const storage = companionStorage()
    if (storage === undefined) throw new Error('storage refused')
    const { storedMode, port } = companionPreferencesPort(storage)
    expect(storedMode).toBe('hc-dark')
    await expect(port.read()).resolves.toEqual({ ui: 'system', code: 'Fira Code', ligatures: true })
  })
  it('reads corrupt storage and an unknown mode as absent', () => {
    globalThis.localStorage.setItem(COMPANION_APPEARANCE_STORAGE_KEY, '{oops')
    const storage = companionStorage()
    if (storage === undefined) throw new Error('storage refused')
    expect(companionPreferencesPort(storage).storedMode).toBeUndefined()
    storedAppearance({ mode: 'neon' })
    expect(companionPreferencesPort(storage).storedMode).toBeUndefined()
  })
  it('round-trips a font save while preserving the stored mode', async () => {
    storedAppearance({ mode: 'dark' })
    const storage = companionStorage()
    if (storage === undefined) throw new Error('storage refused')
    const { port } = companionPreferencesPort(storage)
    await port.write(fontPreferencesSchema.parse({ ui: 'system' }))
    const reread = companionPreferencesPort(storage)
    expect(reread.storedMode).toBe('dark')
    await expect(reread.port.read()).resolves.toEqual({
      ui: 'system',
      code: 'JetBrains Mono',
      ligatures: false,
    })
  })
})

describe('companion theme port', () => {
  it('starts from empty Muse-palette roles and pushes operating-system changes', () => {
    const theme = companionThemePort('light')
    expect(theme.current()).toEqual({ mode: 'light', roles: {} })
    const seen: unknown[] = []
    const unsubscribe = theme.subscribe((snapshot: unknown) => {
      seen.push(snapshot)
    })
    theme.update('dark')
    expect(theme.current()).toEqual({ mode: 'dark', roles: {} })
    expect(seen).toEqual([{ mode: 'dark', roles: {} }])
    unsubscribe()
    theme.update('light')
    expect(seen).toHaveLength(1)
  })
})

describe('companion font token fallbacks', () => {
  it('matches the generated Muse stacks', () => {
    const muse = readFileSync('design/tokens/generated/muse.css', 'utf8')
    const ui = Array.from(
      muse.matchAll(/--ms-font-ui:\s*([^;]+);/gu),
      (match) => match[1]?.trim() ?? '',
    )
    const code = Array.from(
      muse.matchAll(/--ms-font-code:\s*([^;]+);/gu),
      (match) => match[1]?.trim() ?? '',
    )
    expect(new Set(ui).size).toBe(1)
    expect(new Set(code).size).toBe(1)
    // The companion applies these only when the generated sheets have not
    // loaded yet; the computed-stacks case below proves the loaded sheets win.
    expect(ui[0]).toBe("inter, 'Segoe UI', sans-serif")
    expect(code[0]).toBe("'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace")
  })
})

describe('loadCompanionTheme', () => {
  it('mounts the stored mode with stored fonts on the document element', async () => {
    const seen = system(false)
    storedAppearance({ mode: 'dark', ui: 'system', code: 'Cascadia Code', ligatures: true })
    await mount('a'.repeat(64), { system: seen.system })
    expect(document.documentElement.dataset['msTheme']).toBe('dark')
    const fonts = document.head.querySelector('style[data-ms-companion-fonts]')
    expect(fonts?.textContent).toContain('--ms-font-ui:system-ui, sans-serif')
    expect(fonts?.textContent).toContain('"Cascadia Code", "Muse Code CC"')
    expect(fonts?.textContent).toContain('--ms-code-ligatures:normal')
    // A stored mode ignores later operating-system changes.
    seen.emit(true)
    expect(document.documentElement.dataset['msTheme']).toBe('dark')
  })
  it('follows the operating system live without a stored mode', async () => {
    const seen = system(false)
    await mount('b'.repeat(64), { system: seen.system })
    expect(document.documentElement.dataset['msTheme']).toBe('light')
    seen.emit(true)
    expect(document.documentElement.dataset['msTheme']).toBe('dark')
  })
  it('mounts on the operating system without any storage', async () => {
    const seen = system(true)
    await mount('0'.repeat(64), { storage: undefined, system: seen.system })
    expect(document.documentElement.dataset['msTheme']).toBe('dark')
  })
  it('prefers the loaded sheets computed stacks over the built-in fallbacks', async () => {
    const sheets = document.createElement('style')
    sheets.dataset['testSheets'] = ''
    sheets.textContent =
      ':root{--ms-font-ui: LoadedUI, sans-serif; --ms-font-code: LoadedCode, monospace}'
    document.head.append(sheets)
    await mount('1'.repeat(64))
    const fonts = document.head.querySelector('style[data-ms-companion-fonts]')
    expect(fonts?.textContent).toContain('LoadedUI')
    expect(fonts?.textContent).toContain('LoadedCode')
  })
  it('falls back to the token stacks on invalid stored preferences', async () => {
    storedAppearance({ mode: 'light', ui: 42 })
    await mount('c'.repeat(64))
    expect(document.documentElement.dataset['msTheme']).toBe('light')
    const fonts = document.head.querySelector('style[data-ms-companion-fonts]')
    expect(fonts?.textContent).toContain('"Inter", "Muse UI"')
  })
  it('resolves undefined on an aborted load and leaves no owned elements', async () => {
    const controller = new AbortController()
    controller.abort()
    const seen = system(false)
    await expect(
      loadCompanionTheme({
        root: document.documentElement,
        nonce: 'd'.repeat(64),
        storage: companionStorage(),
        system: seen.system,
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined()
    expect(document.head.querySelector('style[data-ms-companion-fonts]')).toBeNull()
    expect(document.documentElement.dataset['msTheme']).toBeUndefined()
  })
  it('disposes the bridge, the font element and the system listener together', async () => {
    const seen = system(false)
    const dispose = await mount('e'.repeat(64), { system: seen.system })
    dispose()
    expect(document.head.querySelector('style[data-ms-companion-fonts]')).toBeNull()
    expect(document.head.querySelector('style[data-ms-theme-vars]')).toBeNull()
    expect(document.documentElement.dataset['msTheme']).toBeUndefined()
    seen.emit(true)
    expect(document.documentElement.dataset['msTheme']).toBeUndefined()
  })
  it('carries the page nonce on the font element for the style policy', async () => {
    await mount('f'.repeat(64))
    expect(
      document.head.querySelector('style[data-ms-companion-fonts]')?.getAttribute('nonce'),
    ).toBe('f'.repeat(64))
  })
})
