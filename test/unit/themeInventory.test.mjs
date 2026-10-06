import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectThemeVariables } from '../../scripts/lib/themeInventory.mjs'

describe('M114 imported host theme inventory', () => {
  it('follows nested CSS imports, terminates cycles and normalizes Windows paths', () => {
    mkdirSync('temp', { recursive: true })
    const root = mkdtempSync(path.resolve('temp/m114-theme-'))
    try {
      mkdirSync(path.join(root, 'src'))
      mkdirSync(path.join(root, 'design'))
      writeFileSync(path.join(root, 'src/main.css'), '@import "../design/roles.css";')
      writeFileSync(
        path.join(root, 'design/roles.css'),
        '@import url("nested.css"); --vscode-focusBorder;',
      )
      writeFileSync(
        path.join(root, 'design/nested.css'),
        '@import "roles.css"; --vscode-widget-shadow;',
      )
      const variables = collectThemeVariables([String.raw`src\main.css`], root)
      expect([...variables.get('--vscode-widget-shadow')]).toEqual(['design/nested.css'])
      expect([...variables.get('--vscode-focusBorder')]).toEqual(['design/roles.css'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('records the real generated host roles imported by both polished surfaces', () => {
    const variables = collectThemeVariables([
      'src/webview/styles.css',
      'src/webview/whatsNew/whatsNew.css',
    ])
    expect(variables.get('--vscode-widget-shadow')).toContain('src/webview/tokens.css')
    expect(variables.get('--vscode-input-placeholderForeground')).toContain(
      'design/tokens/generated/host-roles.css',
    )
  })
})
