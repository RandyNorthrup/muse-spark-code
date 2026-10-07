import * as z from 'zod/mini'
import { hostRoles } from '../../../../design/tokens/generated/consumers.json'

/** Internal, post-validation dependency. M104 owns the captured MHP adapter. */
export interface ThemePort {
  /** A complete snapshot; missing roles fall back to the generated Muse palette. */
  current(): unknown
  subscribe(receive: (snapshot: unknown) => void): () => void
}

const snapshotSchema = z.strictObject({
  mode: z.enum(['light', 'dark', 'hc-light', 'hc-dark']),
  // Check original keys before record parsing can discard __proto__.
  roles: z.pipe(
    z
      .unknown()
      .check(
        z.refine(
          (roles) =>
            typeof roles === 'object' &&
            roles !== null &&
            Object.keys(roles).every((role) => Object.hasOwn(hostRoles, role)),
        ),
      ),
    z.record(z.string(), z.string()),
  ),
})

const themeClasses = [
  'vscode-light',
  'vscode-dark',
  'vscode-high-contrast-light',
  'vscode-high-contrast',
]
const modeClasses = {
  light: 'vscode-light',
  dark: 'vscode-dark',
  'hc-light': 'vscode-high-contrast-light',
  'hc-dark': 'vscode-high-contrast',
}

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

/** Own only this root's theme properties; disposal restores them byte-for-byte. */
export function mountThemeBridge(
  root: HTMLElement,
  port: ThemePort,
  onInvalid: () => void,
): () => void {
  const previousMode = root.dataset['msTheme']
  const previousClasses = themeClasses.filter((name) => root.classList.contains(name))
  const properties = new Set(
    Object.values(hostRoles).flatMap(({ variable, vscode }) => [variable, ...vscode]),
  )
  const previousStyles = [...properties].map((property) => ({
    property,
    value: root.style.getPropertyValue(property),
    priority: root.style.getPropertyPriority(property),
  }))
  const probe = root.ownerDocument.createElement('span').style
  let isActive = true

  const restore = () => {
    for (const { property, value, priority } of previousStyles) {
      if (value === '') root.style.removeProperty(property)
      else root.style.setProperty(property, value, priority)
    }
    if (previousMode === undefined) delete root.dataset['msTheme']
    else root.dataset['msTheme'] = previousMode
    root.classList.remove(...themeClasses)
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
    root.dataset['msTheme'] = mode
    root.classList.remove(...themeClasses)
    root.classList.add(modeClasses[mode])
    const aliases = new Set<string>()
    for (const [role, { variable, vscode }] of Object.entries(hostRoles)) {
      const value = roles[role]
      if (value === undefined) root.style.removeProperty(variable)
      else root.style.setProperty(variable, value)
      // Shared components still read some VS Code variables directly. The
      // first role wins a shared alias (raised and overlay share one).
      for (const alias of vscode) {
        if (!aliases.has(alias)) root.style.setProperty(alias, `var(${variable})`)
        aliases.add(alias)
      }
    }
  }

  // Subscribe before reading so a change during startup cannot be missed.
  let unsubscribe: (() => void) | undefined
  try {
    unsubscribe = port.subscribe(receive)
    receive(port.current())
  } catch (error) {
    isActive = false
    try {
      unsubscribe?.()
    } finally {
      restore()
    }
    throw error
  }
  return () => {
    if (!isActive) return
    isActive = false
    try {
      unsubscribe()
    } finally {
      restore()
    }
  }
}
