import type { UiTable } from '../l10n'
import { buildWebviewHtml, scriptSafeJson } from '../html'
import { escapeHtml } from '../whatsNew/whatsNewHtml'
import { panelBindingSchema, type MhpPanelBinding } from '../../shared/hostApi/panel'
import { themeSchema } from '../../shared/hostApi/data'
import type * as z from 'zod/mini'

const THEME_KINDS = {
  light: 'light',
  dark: 'dark',
  highContrastLight: 'hc-light',
  highContrastDark: 'hc-dark',
} as const

/** Host-owned binding and assets only. No credential is an HTML option. */
export function buildPageHtml(options: {
  readonly bridge: 'native' | 'companion'
  readonly binding: MhpPanelBinding
  readonly scriptUri: string
  readonly styleUri: string
  readonly nonce: string
  readonly assetOrigin: string
  readonly l10n: UiTable
  readonly theme: z.infer<typeof themeSchema>
}): string {
  const binding = panelBindingSchema.parse(options.binding)
  const theme = themeSchema.parse(options.theme)
  // Nonces are CSP source expressions as well as attributes. HTML escaping
  // alone cannot stop a quote from introducing another CSP source.
  if (!/^[\w-]+$/u.test(options.nonce)) throw new TypeError('MHP_INVALID_NONCE')
  const declarations = Object.entries(theme.tokens)
    .map(([name, value]) => {
      // A theme value is one CSS value, never a rule, URL or markup. The frozen
      // MHP spelling maps to the repository's kebab-case --ms-* convention.
      if (/[;{}<>@]/u.test(value) || /url\s*\(/iu.test(value))
        throw new TypeError('MHP_INVALID_THEME')
      const token = name
        .replace('--muse-', '--ms-')
        .replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
      return `${token}:${value}`
    })
    .join(';')
  const html = buildWebviewHtml({
    scriptUri: escapeHtml(options.scriptUri),
    styleUri: escapeHtml(options.styleUri),
    nonce: escapeHtml(options.nonce),
    cspSource: escapeHtml(options.assetOrigin),
    l10n: options.l10n,
  })
  return html
    .replace('<html lang=', () => `<html data-theme="${THEME_KINDS[theme.kind]}" lang=`)
    .replace(
      '<body ',
      () => `<body data-bridge="${options.bridge}" data-surface="${binding.surfaceKind}" `,
    )
    .replace(
      '</head>',
      () =>
        `<style nonce="${escapeHtml(options.nonce)}">:root[data-theme]{${declarations}}</style></head>`,
    )
    .replace(
      '</body>',
      () =>
        `<script type="application/json" id="muse-panel">${scriptSafeJson(binding)}</script></body>`,
    )
    .replace(
      "default-src 'none';",
      () =>
        `default-src 'none'; connect-src ${options.bridge === 'companion' ? "'self'" : "'none'"};`,
    )
}
