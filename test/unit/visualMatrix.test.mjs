import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { collectThemeVariables } from '../../scripts/lib/themeInventory.mjs'
import { contrastRatio } from '../../scripts/check-tokens.mjs'

const matrix = JSON.parse(
  readFileSync(new URL('../harness/visual-matrix.json', import.meta.url), 'utf8'),
)
const captures = [
  {
    kind: 'one-dark-pro',
    extension: 'zhuangtongfa.material-theme',
    version: '3.20.2',
    sha256: '4b7eb37f3aeedd11058cba23582c8814d65399ec85aee171274fcb15b4308213',
    member: 'extension/themes/OneDark-Pro.json',
    memberSha256: '186fbbd1ef99a9fb6548fac7a1d354b925a7f9b98da97ef7649e22e20d08c756',
    coloursSha256: 'a183a80cbfd3e5440d0fbc2ba8662d88e90e70a35811aa629163367d99529a80',
    resolvedSha256: '9a2d78b943ebd99fdc6ff4fba0356318e46631b053487488bcfa64b0e21ace8c',
    licenseSha256: 'b4bdb28c670386f4fa093650b0bb8773714ce53171a2d1a9adb81756119200f1',
    pairs: 22,
    failures: 6,
  },
  {
    kind: 'dracula',
    extension: 'dracula-theme.theme-dracula',
    version: '2.25.1',
    sha256: 'f4d8c28fc64874b1b959cc90dbd39c84d5d35c9cf203e32b7a758dc9abf5b1cb',
    member: 'extension/theme/dracula.json',
    memberSha256: 'ae473d11bdef6ad5d3fc3c6cf3a104e98c9fd8a195f13c5cc1699df33a2537eb',
    coloursSha256: '87d1ef538ce6e23edead6f9c0332e3cb7c601b9ac7d767ebcd7cc50ea509b720',
    resolvedSha256: 'e77dd0866158e44dca4cd05112d3b2f98eb634d55464be4a845090e0f6cc69ff',
    licenseSha256: 'f08d0bba7f8906ed4e7a76d7e555a883968d83eb550ae298ce893a65aee15dff',
    pairs: 21,
    failures: 3,
  },
]
const digest = (value) => createHash('sha256').update(value).digest('hex')
const compareNames = (a, b) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}
const themeOf = (kind) => JSON.parse(readFileSync(`test/harness/themes/${kind}.json`, 'utf8'))
const colour = (value) => {
  expect(value).toMatch(/^(?:#[\da-f]{6}(?:[\da-f]{2})?|rgba?\([\d., ]+\))$/i)
  const channels = value.startsWith('#')
    ? value
        .slice(1)
        .match(/../g)
        .map((n) => Number.parseInt(n, 16) / 255)
    : value
        .match(/[\d.]+/g)
        .map(Number)
        .map((n, i) => (i < 3 ? n / 255 : n))
  return { colorSpace: 'srgb', components: channels.slice(0, 3), alpha: channels[3] ?? 1 }
}

describe('M114 lane 0 visual contract', () => {
  it('covers every React component and the separate What’s New surface for A’s audit', () => {
    const components = readdirSync('src/webview', { recursive: true })
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `src/webview/${name.replaceAll('\\', '/')}`)
    components.push('src/webview/whatsNew/whatsNewPage.ts')
    expect(matrix.componentAuditInputs).toEqual(
      components.toSorted((a, b) => {
        if (a === b) return 0
        return a < b ? -1 : 1
      }),
    )
  })

  it('fixes six themes, narrow and regular widths, and every interaction state for S', () => {
    expect(matrix.themes).toEqual([
      'light',
      'dark',
      'hc-dark',
      'hc-light',
      'one-dark-pro',
      'dracula',
    ])
    expect(matrix.widths).toEqual([320, 690])
    expect(matrix.states).toEqual([
      'default',
      'hover',
      'focus-visible',
      'pressed',
      'disabled',
      'selected',
    ])
    expect(matrix.goldenPath).toBe(
      'test/harness/goldens/{surface}/{component}/{state}/{theme}/{width}.png',
    )
  })

  it('requires reviewed golden updates with a stable capture environment and named external owners', () => {
    expect(matrix.capture).toEqual({
      locale: 'en',
      timezone: 'UTC',
      reducedMotion: true,
      animations: 'disabled',
      reviewedUpdatesOnly: true,
    })
    expect(matrix.height).toBe(760)
    expect(matrix.deviceScaleFactor).toBe(1)
    expect(matrix.pendingSurfaceOwners).toEqual({
      companion: 'C',
      native: 'C',
      node: 'N',
      desktop: 'D',
      installer: 'D',
      tui: 'N / TD',
    })
  })

  it.each(captures)(
    'records the exact archive provenance and colour bytes for $kind',
    (capture) => {
      const theme = themeOf(capture.kind)
      const { kind, coloursSha256, resolvedSha256, licenseSha256, pairs, failures, ...provenance } =
        capture
      expect(theme.kind).toBe(kind)
      expect(theme.bodyClass).toBe('vscode-dark')
      expect(theme.provenance).toMatchObject({ ...provenance, license: 'MIT' })
      expect(theme.provenance.archive).toBe(`${capture.extension}-${capture.version}.vsix`)
      expect(theme.provenance.licenseText).toContain('Permission is hereby granted, free of charge')
      expect(theme.provenance.licenseText).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
      expect(theme.provenance.licenseText).toContain(
        kind === 'dracula'
          ? 'Copyright (c) 2016 Dracula Theme'
          : 'Copyright (c) 2013-2022 Binaryify',
      )
      const explicit = Object.fromEntries(
        Object.entries(theme.variables).filter(([name]) =>
          theme.provenance.explicitVariables.includes(name),
        ),
      )
      expect(digest(JSON.stringify(explicit))).toBe(coloursSha256)
      expect(digest(JSON.stringify(theme.variables))).toBe(resolvedSha256)
      expect(theme.provenance.hostVersion).toBe('1.130.0')
      expect(digest(theme.provenance.licenseText)).toBe(licenseSha256)
      expect(matrix.themeCaptures[kind].fixture).toBe(`test/harness/themes/${kind}.json`)
      expect(matrix.themeCaptures[kind].contrastPairs).toHaveLength(pairs)
      expect(
        matrix.themeCaptures[kind].contrastPairs.filter((pair) => !pair.passesAA),
      ).toHaveLength(failures)
    },
  )

  it.each(captures)(
    'separates absent archive entries from captured registered defaults for $kind',
    ({ kind }) => {
      const files = readdirSync('src/webview', { recursive: true })
        .filter((name) => /\.(?:tsx?|css)$/.test(name))
        .map((name) => `src/webview/${name.replaceAll('\\', '/')}`)
      const used = new Set(['--vscode-editor-foreground', ...collectThemeVariables(files).keys()])
      const theme = themeOf(kind)
      expect([...Object.keys(theme.variables), ...theme.unset].toSorted(compareNames)).toEqual(
        [...used].toSorted(compareNames),
      )
      expect(
        [...theme.provenance.explicitVariables, ...theme.absentInArchive].toSorted(compareNames),
      ).toEqual([...used].toSorted(compareNames))
      expect(theme.provenance.explicitVariables).toEqual(
        Object.keys(theme.variables).filter((name) => !theme.absentInArchive.includes(name)),
      )
      expect(theme.provenance.method).toContain('archive-colours-plus-registered-defaults')
      expect(theme.unset).toContain('--vscode-font-family')
      for (const value of Object.values(theme.variables)) colour(value)
    },
  )

  it.each(captures)(
    'measures AA outcomes honestly, including focus neighbours and alpha hover for $kind',
    ({ kind }) => {
      const theme = themeOf(kind)
      const row = matrix.themeCaptures[kind]
      const at = (name) => colour(theme.variables[name])
      expect(row.contrastScope).toContain('captured VS Code 1.130.0 registered defaults')
      for (const pair of row.contrastPairs) {
        expect(['text', 'ui']).toContain(pair.usage)
        const background = at(pair.background)
        if (background.alpha < 1) expect(pair.canvas).toBeDefined()
        const ratio = contrastRatio(
          at(pair.foreground),
          background,
          pair.canvas === undefined ? undefined : at(pair.canvas),
        )
        expect(ratio).toBeCloseTo(pair.ratio, 3)
        expect(pair.passesAA).toBe(ratio >= (pair.usage === 'text' ? 4.5 : 3))
      }
      expect(
        row.contrastPairs
          .filter((pair) => pair.foreground === '--vscode-focusBorder')
          .map((pair) => pair.background),
      ).toEqual([
        '--vscode-sideBar-background',
        '--vscode-editorWidget-background',
        '--vscode-input-background',
        '--vscode-button-background',
      ])
      if (kind === 'dracula') {
        expect(row.contrastPairs).toContainEqual(
          expect.objectContaining({
            foreground: '--vscode-foreground',
            background: '--vscode-list-hoverBackground',
            canvas: '--vscode-sideBar-background',
          }),
        )
      }
    },
  )
})
