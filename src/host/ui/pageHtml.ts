import type { UiTable } from '../l10n'
import { buildWebviewHtml } from '../html'
import { panelBindingSchema, type MhpPanelBinding } from '../../shared/hostApi/panel'
import { themeSchema } from '../../shared/hostApi/data'
import type * as z from 'zod/mini'

function attribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
function data(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', String.raw`\u003c`)
}
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
    scriptUri: attribute(options.scriptUri),
    styleUri: attribute(options.styleUri),
    nonce: attribute(options.nonce),
    cspSource: attribute(options.assetOrigin),
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
        `<style nonce="${attribute(options.nonce)}">:root[data-theme]{${declarations}}</style></head>`,
    )
    .replace(
      '</body>',
      () => `<script type="application/json" id="muse-panel">${data(binding)}</script></body>`,
    )
    .replace(
      "default-src 'none';",
      () =>
        `default-src 'none'; connect-src ${options.bridge === 'companion' ? "'self'" : "'none'"};`,
    )
}
