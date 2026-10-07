import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { auditRoot, digest, readAudit, sourcesAtRevision } from './helpers/m114AuditCapture.mjs'

const key = (scene, theme, width) => `${scene}/${theme}/${width}`
const historicalRevision = '58ed2fc1d232d89491c441f44cfbd12539e8b4a1'
const audit = await readAudit(historicalRevision)
const matrix = JSON.parse(
  execFileSync('git', ['show', `${historicalRevision}:test/harness/visual-matrix.json`], {
    cwd: auditRoot,
    encoding: 'utf8',
  }),
)
const consumers = JSON.parse(
  execFileSync('git', ['show', `${historicalRevision}:design/tokens/generated/consumers.json`], {
    cwd: auditRoot,
    encoding: 'utf8',
  }),
)
const beforeDirectory = path.join(auditRoot, 'docs/certification/m114-a-before')
const manifest = JSON.parse(readFileSync(path.join(beforeDirectory, 'manifest.json'), 'utf8'))
const capturesDirectory = process.env.MUSE_M114_CAPTURES_DIR
const compareNames = (a, b) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}

describe('M114 A complete before-state audit', () => {
  it('grades every renderer and classifies every remaining webview file exactly once', () => {
    expect(audit.components.map((row) => row.file)).toEqual(matrix.componentAuditInputs)
    const files = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', historicalRevision, '--', 'src/webview'],
      { cwd: auditRoot, encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .toSorted(compareNames)
    const recorded = [...audit.components, ...audit.otherWebviewFiles].map((row) => row.file)
    expect(recorded.toSorted(compareNames)).toEqual(files)
    expect(audit.sources.map((entry) => entry.file).toSorted(compareNames)).toEqual(files)
    const sources = sourcesAtRevision(historicalRevision, files)
    for (const { file, sha256: hash } of audit.sources)
      expect(digest(sources.get(file)), file).toBe(hash)
  })

  it('gives each component every grade dimension and an actionable owned fix with source evidence', () => {
    expect(audit.dimensions).toEqual([
      'colour',
      'radius',
      'elevation',
      'motion',
      'focus',
      'states',
      'highContrast',
      'accessibility',
      'typographySpacing',
    ])
    for (const row of audit.components) {
      expect(['P1', 'P2']).toContain(row.owner)
      expect(Object.keys(row.grades)).toEqual(audit.dimensions)
      for (const grade of Object.values(row.grades))
        expect(['partial', 'fail', 'inherited', 'not-applicable']).toContain(grade)
      expect(row.fix.length).toBeGreaterThan(60)
      expect(row.selectors.length).toBeGreaterThan(0)
      expect(audit.scenes).toContain(row.scene)
      for (const id of row.findings) expect(audit.findings[id]).toBeDefined()
      expect(row.evidence.length).toBeGreaterThan(0)
      for (const evidence of row.evidence) {
        expect(evidence.line).toBeGreaterThan(0)
        expect(evidence.selector.length).toBeGreaterThan(0)
        expect(evidence.declarations.length).toBeGreaterThan(0)
      }
    }
    expect(audit.externalSurfaces.map((row) => [row.surface, row.owner, row.grade])).toEqual(
      Object.entries(matrix.pendingSurfaceOwners).map(([surface, owner]) => [
        surface,
        owner,
        'unavailable-on-base',
      ]),
    )
    for (const row of audit.externalSurfaces) expect(row.fix.length).toBeGreaterThan(60)
  })

  it('maps every component role to the frozen exact VS Code contract without invented roles', () => {
    expect(audit.roleMap).toEqual(consumers.hostRoles)
    expect(Object.keys(audit.unmappedHostVariables)).toEqual(['--vscode-errorForeground'])
    expect(audit.unmappedHostVariables['--vscode-errorForeground'].fix).toContain(
      'distinct host-error foreground mapping',
    )
    const known = new Set(Object.values(consumers.hostRoles).flatMap((entry) => entry.vscode))
    for (const row of audit.components) {
      for (const variable of row.vscodeVariables) {
        expect(known.has(variable) || Object.hasOwn(audit.unmappedHostVariables, variable)).toBe(
          true,
        )
      }
    }

    for (const row of audit.components) {
      expect(row.roles.length).toBeGreaterThan(0)
      for (const role of row.roles) expect(consumers.hostRoles[role]).toBeDefined()
    }
    const trace = audit.components.find((row) => row.file.endsWith('HeartbeatTrace.tsx'))
    expect(trace.fix).toContain('--ms-progress')
    expect(audit.findings.focus.fix).toContain('--ms-focus-width (2 px)')
  })

  it('retains the upstream AA failures and the narrow approval, motion and HC fixes honestly', () => {
    const report = readFileSync(`${auditRoot}/docs/certification/m114-audit.md`, 'utf8')
      .split('\n')
      .map((line) =>
        line
          .split('|')
          .map((cell) => cell.trim())
          .join('|'),
      )
      .join('\n')
    for (const [theme, capture] of Object.entries(matrix.themeCaptures)) {
      for (const pair of capture.contrastPairs) {
        if (pair.passesAA) continue
        expect(report).toContain(
          `|${theme}|\`${pair.foreground}\` / \`${pair.background}\`|${pair.ratio.toFixed(3)}:1`,
        )
      }
    }
    const approval = audit.components.find((row) => row.file.endsWith('/ApprovalCard.tsx'))
    expect(approval.findings).toContain('approval')
    expect(approval.grades.accessibility).toBe('fail')
    expect(audit.findings.approval.fix).toContain('flex-basis:100%')
    expect(audit.findings.motion.fix).toContain('Remove streamed cursor blink')
    expect(audit.findings.overlay.fix).toContain('opaque and shadowless')
  })

  it('preserves a complete unique six-theme two-width manifest with component renders, hashes and byte sizes', () => {
    expect(manifest).toMatchObject({
      base: audit.base,
      locale: 'en',
      timezone: 'UTC',
      reducedMotion: true,
      deviceScaleFactor: 1,
      animations: 'disabled',
      network: 'loopback-only',
      kind: 'before-observation-not-golden',
    })
    expect(manifest.browser).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    const expected = audit.scenes.flatMap((scene) =>
      matrix.themes.flatMap((theme) => matrix.widths.map((width) => key(scene, theme, width))),
    )
    expect(matrix.themes).toHaveLength(6)
    expect(matrix.widths).toEqual([320, 690])
    const actual = manifest.captures.map((row) => key(row.scene, row.theme, row.width))
    expect(new Set(actual).size).toBe(actual.length)
    expect(actual.toSorted(compareNames)).toEqual(expected.toSorted(compareNames))
    for (const capture of manifest.captures) {
      expect(capture.file.replaceAll('\\', '/')).toBe(
        `docs/certification/m114-a-before/${capture.scene}/${capture.theme}/${capture.width}.png`,
      )
      expect(capture.height).toBe(matrix.height)
      expect(capture.sha256).toMatch(/^[\da-f]{64}$/)
      expect(Number.isSafeInteger(capture.bytes)).toBe(true)
      expect(capture.bytes).toBeGreaterThan(0)
      expect(capture.renderedComponents).toEqual(
        audit.components.filter((row) => row.scene === capture.scene).map((row) => row.file),
      )
      expect(capture.elements.length).toBeGreaterThan(0)
    }
  })

  it(
    capturesDirectory === undefined
      ? 'keeps PNGs outside the repository; bytes are verified out of tree with MUSE_M114_CAPTURES_DIR'
      : 'verifies every archived PNG byte size, dimensions and SHA-256 with MUSE_M114_CAPTURES_DIR',
    () => {
      const files = readdirSync(beforeDirectory, { recursive: true })
      expect(files.filter((file) => file.endsWith('.png'))).toEqual([])
      if (capturesDirectory === undefined) return
      expect(capturesDirectory.length).toBeGreaterThan(0)
      for (const capture of manifest.captures) {
        const bytes = readFileSync(
          path.join(capturesDirectory, capture.scene, capture.theme, `${capture.width}.png`),
        )
        expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        expect(bytes.readUInt32BE(16)).toBe(capture.width)
        expect(bytes.readUInt32BE(20)).toBe(matrix.height)
        expect(bytes.length).toBe(capture.bytes)
        expect(digest(bytes)).toBe(capture.sha256)
      }
    },
  )
})

describe('M114 integrated coverage', () => {
  it('classifies every current renderer and supporting file with current source hashes', async () => {
    const current = await readAudit()
    const currentMatrix = JSON.parse(
      readFileSync(`${auditRoot}/test/harness/visual-matrix.json`, 'utf8'),
    )
    const files = readdirSync(`${auditRoot}/src/webview`, { recursive: true })
      .map((name) => `src/webview/${name.replaceAll('\\', '/')}`)
      .filter((name) => /\.[^/]+$/.test(name))
      .toSorted(compareNames)
    expect(current.components.map((row) => row.file)).toEqual(currentMatrix.componentAuditInputs)
    expect(
      [...current.components, ...current.otherWebviewFiles]
        .map((row) => row.file)
        .toSorted(compareNames),
    ).toEqual(files)
    expect(current.sources.map((row) => row.file)).toEqual(files)
    for (const row of current.sources)
      expect(digest(readFileSync(path.join(auditRoot, row.file))), row.file).toBe(row.sha256)
    for (const row of current.components) {
      expect(current.scenes).toContain(row.scene)
      expect(row.captureSelector.length).toBeGreaterThan(0)
    }
    expect(current.historicalAuditRevision).toBe(historicalRevision)
  })
})
