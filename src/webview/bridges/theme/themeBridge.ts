import * as z from 'zod/mini'
import { hostRoles } from '../../../../design/tokens/generated/consumers.json'

/** Internal, post-validation dependency. M104 owns the captured MHP adapter. */
export interface ThemePort {
  /** A complete snapshot; missing roles fall back to the generated Muse palette. */
  current(): unknown
  subscribe(receive: (snapshot: unknown) => void): () => void
}

/** Page-controlled options for the internal consumer. */
export interface ThemeBridgeOptions {
  /**
   * The page's style nonce. Host values ride in a bridge-owned `<style>`
   * element carrying it, which a strict `style-src` policy admits. Inline
   * `style` writes would be refused there: a nonce never covers them.
   */
  readonly nonce?: string
}

const snapshotSchema = z.strictObject({
  mode: z.enum(['light', 'dark', 'hc-light', 'hc-dark']),
  // Validate every original key before a record parser can discard __proto__.
  roles: z.custom<Record<string, string>>(
    (roles: unknown) =>
      typeof roles === 'object' &&
      roles !== null &&
      Object.entries(roles).every(
        ([role, value]) => Object.hasOwn(hostRoles, role) && typeof value === 'string',
      ),
  ),
})

const modeClasses = {
  light: 'vscode-light',
  dark: 'vscode-dark',
  'hc-light': 'vscode-high-contrast-light',
  'hc-dark': 'vscode-high-contrast',
}
const themeClasses = Object.values(modeClasses)

// Only literal colours cross this internal port: no URLs, variable references
// or CSS-wide keywords. The browser then checks the actual colour syntax.
const colourLiteral =
  /^(?:#[\da-f]+|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([\da-z\s.,%/+-]+\)|[a-z]+)$/i
const cssWide = /^(?:inherit|initial|unset|revert|revert-layer|currentcolor)$/i

function isValidValue(role: string, value: string, probe: CSSStyleDeclaration): boolean {
  let property = 'color'
  if (role === 'typography.font-ui' || role === 'typography.font-code') {
    property = 'font-family'
    if (/[;{}()\r\n]/.test(value)) return false
  } else if (role === 'typography.font-size' || role === 'typography.code-size') {
    property = 'font-size'
    if (!/^\d+(?:\.\d+)?px$/.test(value) || Number(value.replaceAll('px', '')) <= 0) return false
  } else if (!colourLiteral.test(value)) {
    return false
  }
  if (cssWide.test(value.trim())) return false
  probe.removeProperty(property)
  probe.setProperty(property, value)
  return probe.getPropertyValue(property) !== ''
}

/** Marks the bridge-owned declarations element, for tests and disposal. */
const OWNED_ATTRIBUTE = 'data-ms-theme-vars'

/** Mint one scope class per mount; the counter is this module's only state. */
const scopeSequence = { value: 0 }

/** Own only this root's theme state; disposal removes it byte-for-byte. */
export function mountThemeBridge(
  root: HTMLElement,
  port: ThemePort,
  onInvalid: () => void,
  options?: ThemeBridgeOptions,
): () => void {
  const previousMode = root.dataset['msTheme']
  const previousClasses = themeClasses.filter((name) => root.classList.contains(name))
  // Scopes the owned declarations to this root when several share a page.
  scopeSequence.value += 1
  const scopeClass = `ms-theme-vars-${scopeSequence.value.toString()}`
  const probe = root.ownerDocument.createElement('span').style
  let isActive = true
  let owned: HTMLStyleElement | undefined

  const restore = () => {
    owned?.remove()
    owned = undefined
    if (previousMode === undefined) delete root.dataset['msTheme']
    else root.dataset['msTheme'] = previousMode
    root.classList.remove(...themeClasses, scopeClass)
    root.classList.add(...previousClasses)
  }

  const receive = (snapshot: unknown) => {
    if (!isActive) return
    const parsed = snapshotSchema.safeParse(snapshot)
    if (
      !parsed.success ||
      Object.entries(parsed.data.roles).some(([role, value]) => !isValidValue(role, value, probe))
    ) {
      onInvalid()
      return
    }

    const { mode, roles } = parsed.data
    // Values are validated literals (no `;{}` or line breaks), so they
    // cannot break out of their declarations below.
    const declarations: string[] = []
    const aliases = new Set<string>()
    for (const [role, { variable, vscode }] of Object.entries(hostRoles)) {
      // A missing role stays absent so the generated Muse palette shows
      // through; the shared aliases always resolve through it.
      const value = roles[role]
      if (value !== undefined) declarations.push(`${variable}:${value}`)
      // Shared components still read some VS Code variables directly. The
      // first role wins a shared alias (raised and overlay share one).
      for (const alias of vscode) {
        if (!aliases.has(alias)) declarations.push(`${alias}:var(${variable})`)
        aliases.add(alias)
      }
    }
    if (owned === undefined) {
      owned = root.ownerDocument.createElement('style')
      owned.setAttribute(OWNED_ATTRIBUTE, '')
      if (options?.nonce !== undefined) owned.setAttribute('nonce', options.nonce)
    }
    owned.textContent = `.${scopeClass}{${declarations.join(';')}}`
    if (!owned.isConnected) root.ownerDocument.head.append(owned)
    if (owned.sheet === null) {
      // A strict page policy refused the owned element: leave the root
      // exactly as it was and report, instead of showing a half theme.
      owned.remove()
      owned = undefined
      onInvalid()
      return
    }
    root.dataset['msTheme'] = mode
    root.classList.remove(...themeClasses)
    root.classList.add(modeClasses[mode], scopeClass)
  }

  // Subscribe before reading so a change during startup cannot be missed.
  let unsubscribe: (() => void) | undefined
  const dispose = () => {
    if (!isActive) return
    isActive = false
    try {
      unsubscribe?.()
    } finally {
      restore()
    }
  }
  try {
    unsubscribe = port.subscribe(receive)
    receive(port.current())
  } catch (error) {
    dispose()
    throw error
  }
  return dispose
}
