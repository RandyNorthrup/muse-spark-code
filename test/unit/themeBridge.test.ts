// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostRoles } from '../../design/tokens/generated/consumers.json'
import {
  mountThemeBridge,
  type ThemeBridgeOptions,
  type ThemePort,
} from '../../src/webview/bridges/theme/themeBridge'
import { loadThemeBridge } from '../../src/webview/bridges/theme/loadThemeBridge'

function fakePort(initial: unknown) {
  let snapshot = initial
  let receive: ((snapshot: unknown) => void) | undefined
  const unsubscribe = vi.fn()
  const port: ThemePort = {
    current: () => snapshot,
    subscribe: (listener) => {
      receive = listener
      return unsubscribe
    },
  }
  return {
    port,
    unsubscribe,
    emit: (value: unknown) => {
      snapshot = value
      receive?.(value)
    },
  }
}

const modes = ['light', 'dark', 'hc-light', 'hc-dark']
const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
  for (const owned of document.head.querySelectorAll('style[data-ms-theme-vars]')) owned.remove()
})

function mount(initial: unknown, options?: ThemeBridgeOptions) {
  const root = document.createElement('main')
  const sibling = document.createElement('aside')
  document.body.append(root, sibling)
  const producer = fakePort(initial)
  const onInvalid = vi.fn()
  const dispose = mountThemeBridge(root, producer.port, onInvalid, options)
  disposers.push(dispose)
  return { root, sibling, producer, onInvalid, dispose }
}

/** The bridge-owned declarations element for a mounted root, if any. */
function ownedStyle(root: Element): HTMLStyleElement | null {
  return root.ownerDocument.head.querySelector('style[data-ms-theme-vars]')
}

describe('M114 internal theme consumer (M104 wire adapters are an integration handoff)', () => {
  it.each(['companion', 'JCEF', 'WebView2', 'SWT'])(
    '%s port changes every role and mode after mount, within its own root',
    () => {
      const { root, sibling, producer, onInvalid } = mount({ mode: 'dark', roles: {} })
      for (const mode of modes) {
        const roles = Object.fromEntries(
          Object.keys(hostRoles).map((key) => {
            let value = '#abcdef'
            if (key.startsWith('typography.')) {
              value = key.endsWith('size') ? '15px' : 'Consolas, monospace'
            }
            return [key, value]
          }),
        )
        producer.emit({ mode, roles })
        expect(root.dataset['msTheme']).toBe(mode)
        // A strict page policy refuses inline `style` writes, so accepted
        // host values must land in the bridge-owned sheet, never inline.
        expect(root.style.length).toBe(0)
        const text = ownedStyle(root)?.textContent ?? ''
        const aliases = new Set<string>()
        for (const [key, { variable, vscode }] of Object.entries(hostRoles)) {
          expect(text, key).toContain(`${variable}:${roles[key] ?? ''}`)
          for (const alias of vscode) {
            if (!aliases.has(alias)) expect(text, alias).toContain(`${alias}:var(${variable})`)
            aliases.add(alias)
          }
        }
        expect(root.classList.contains('vscode-high-contrast')).toBe(mode === 'hc-dark')
        expect(root.classList.contains('vscode-high-contrast-light')).toBe(mode === 'hc-light')
      }
      expect(onInvalid).not.toHaveBeenCalled()
      expect(sibling.attributes).toHaveLength(0)
      expect(document.documentElement.attributes).toHaveLength(0)
    },
  )

  it('clears omitted colours and typography on a new full snapshot', () => {
    const { root, producer } = mount({
      mode: 'light',
      roles: { 'colour.text': '#123456', 'typography.font-code': 'Consolas, monospace' },
    })
    expect(ownedStyle(root)?.textContent ?? '').toContain('--ms-text:#123456')
    producer.emit({ mode: 'dark', roles: {} })
    const text = ownedStyle(root)?.textContent ?? ''
    expect(text).not.toContain('--ms-text:')
    expect(text).not.toContain('--ms-font-code:')
    expect(text).toContain('--vscode-foreground:var(--ms-text)')
  })

  it('carries the page nonce on the owned element', () => {
    const { root } = mount({ mode: 'dark', roles: {} }, { nonce: 'test-nonce' })
    expect(ownedStyle(root)?.getAttribute('nonce')).toBe('test-nonce')
  })

  it('leaves the root untouched and reports when the page refuses the owned sheet', () => {
    const root = document.createElement('main')
    document.body.append(root)
    // A strict policy exposes no sheet on the refused element; simulate it.
    const sheet = vi.spyOn(HTMLStyleElement.prototype, 'sheet', 'get').mockReturnValue(null)
    try {
      const producer = fakePort({ mode: 'dark', roles: { 'colour.text': '#abcdef' } })
      const onInvalid = vi.fn()
      const dispose = mountThemeBridge(root, producer.port, onInvalid)
      disposers.push(dispose)
      expect(onInvalid).toHaveBeenCalledTimes(1)
      expect(root.outerHTML).toBe('<main></main>')
      expect(ownedStyle(root)).toBeNull()
    } finally {
      sheet.mockRestore()
    }
  })

  it.each([
    null,
    { mode: 'absent', roles: {} },
    { mode: 'dark', roles: {}, wireField: 'not a wire schema' },
    { mode: 'dark', roles: { 'colour.text': 1 } },
    { mode: 'dark', roles: { 'colour.unknown': '#123456' } },
    { mode: 'dark', roles: { constructor: '#123456' } },
    JSON.parse('{"mode":"dark","roles":{"__proto__":"#123456"}}'),
    ...[
      'url(https://invalid.example)',
      'var(--foreign)',
      'inherit',
      'currentColor',
      '#12345',
      'red; display:none',
      'notacolour',
    ].map((value) => ({ mode: 'light', roles: { 'colour.text': value } })),
    ...['0px', '-1px', '15', '12em', 'calc(12px)', '1px; display:none'].map((value) => ({
      mode: 'dark',
      roles: { 'typography.font-size': value },
    })),
    ...[
      'inherit',
      ' inherit ',
      'var(--font)',
      'url(https://invalid.example)',
      'Arial; display:none',
      'Arial\nserif',
    ].map((value) => ({ mode: 'dark', roles: { 'typography.font-ui': value } })),
  ])('refuses an invalid snapshot atomically: %j', (snapshot) => {
    const { root, producer, onInvalid } = mount({
      mode: 'dark',
      roles: { 'colour.text': '#abcdef' },
    })
    const before = root.outerHTML
    producer.emit(snapshot)
    expect(onInvalid).toHaveBeenCalledTimes(1)
    expect(root.outerHTML).toBe(before)
  })

  it('accepts literal alpha and functional host colours checked by the browser', () => {
    const { root, onInvalid } = mount({
      mode: 'dark',
      roles: { 'colour.text': 'rgb(12 34 56)', 'colour.hover': '#abcdef80' },
    })
    expect(onInvalid).not.toHaveBeenCalled()
    const text = ownedStyle(root)?.textContent ?? ''
    expect(text).toContain('--ms-text:rgb(12 34 56)')
    expect(text).toContain('--ms-hover:#abcdef80')
  })

  it('restores prior values, priorities, attributes and classes, and ignores late events', () => {
    const root = document.createElement('main')
    root.dataset['msTheme'] = 'light'
    root.className = 'other vscode-light'
    root.style.setProperty('--ms-text', '#112233', 'important')
    root.style.setProperty('--vscode-font-family', 'Arial')
    root.style.setProperty('width', '100px')
    const before = root.outerHTML
    const producer = fakePort({ mode: 'hc-dark', roles: { 'colour.text': '#aabbcc' } })
    const dispose = mountThemeBridge(root, producer.port, vi.fn())
    dispose()
    dispose()
    producer.emit({ mode: 'dark', roles: { 'colour.text': '#123456' } })
    expect(root.outerHTML).toBe(before)
    expect(producer.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('restores even when unsubscribe throws', () => {
    const { root, producer, dispose } = mount({ mode: 'light', roles: {} })
    producer.unsubscribe.mockImplementationOnce(() => {
      throw new Error('test unsubscribe')
    })
    expect(dispose).toThrow('test unsubscribe')
    expect(root.dataset['msTheme']).toBeUndefined()
    expect(root.style.length).toBe(0)
    dispose()
  })

  it('subscribes before reading, and releases ownership if the initial read throws', () => {
    const root = document.createElement('main')
    const steps: string[] = []
    const port: ThemePort = {
      current: () => {
        steps.push('read')
        throw new Error('test read')
      },
      subscribe: () => {
        steps.push('subscribe')
        return () => {
          steps.push('unsubscribe')
        }
      },
    }
    expect(() => mountThemeBridge(root, port, vi.fn())).toThrow('test read')
    expect(steps).toEqual(['subscribe', 'read', 'unsubscribe'])
    expect(root.style.length).toBe(0)
  })

  it('restores a synchronous subscription update if subscribe then throws', () => {
    const root = document.createElement('main')
    const port: ThemePort = {
      current: () => undefined,
      subscribe: (receive) => {
        receive({ mode: 'light', roles: { 'colour.text': '#123456' } })
        throw new Error('test subscribe')
      },
    }
    expect(() => mountThemeBridge(root, port, vi.fn())).toThrow('test subscribe')
    expect(root.dataset['msTheme']).toBeUndefined()
    expect(root.style.length).toBe(0)
    expect(root.className).toBe('')
  })

  it('loads lazily and disposes with the injected surface lifetime', async () => {
    const root = document.createElement('main')
    const producer = fakePort({ mode: 'dark', roles: {} })
    const controller = new AbortController()
    const stop = await loadThemeBridge(root, producer.port, vi.fn(), controller.signal)
    expect(stop).toBeTypeOf('function')
    expect(root.dataset['msTheme']).toBe('dark')
    controller.abort()
    stop?.()
    expect(producer.unsubscribe).toHaveBeenCalledTimes(1)
    expect(root.dataset['msTheme']).toBeUndefined()
  })

  it('does not subscribe or style a surface cancelled while its chunk loads', async () => {
    const root = document.createElement('main')
    const producer = fakePort({ mode: 'dark', roles: {} })
    const subscribe = vi.spyOn(producer.port, 'subscribe')
    const controller = new AbortController()
    const pending = loadThemeBridge(root, producer.port, vi.fn(), controller.signal)
    controller.abort()
    expect(await pending).toBeUndefined()
    expect(subscribe).not.toHaveBeenCalled()
    expect(root.attributes).toHaveLength(0)
  })

  it('cleans up when the initial invalid notification closes the surface', async () => {
    const root = document.createElement('main')
    const producer = fakePort(null)
    const controller = new AbortController()
    const stop = await loadThemeBridge(
      root,
      producer.port,
      () => {
        controller.abort()
      },
      controller.signal,
    )
    stop?.()
    expect(producer.unsubscribe).toHaveBeenCalledTimes(1)
    expect(root.dataset['msTheme']).toBeUndefined()
  })

  it('uses the two host sheets and the Muse sheet in cascade order without remote assets', () => {
    const entry = readFileSync('src/webview/bridges/theme/themeEntry.ts', 'utf8')
    expect(entry.indexOf('tokens.css')).toBeLessThan(entry.indexOf('host-roles.css'))
    expect(entry.indexOf('host-roles.css')).toBeLessThan(entry.indexOf('muse.css'))
    expect(entry).not.toMatch(/https?:|@font-face/)
  })
})
