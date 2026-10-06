import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditRoot, readAudit } from './helpers/m114AuditCapture.mjs'

const audit = await readAudit()
const matrix = JSON.parse(readFileSync(`${auditRoot}/test/harness/visual-matrix.json`, 'utf8'))
const consumers = JSON.parse(
  readFileSync(`${auditRoot}/design/tokens/generated/consumers.json`, 'utf8'),
)
const compareNames = (a, b) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}

describe('M114 A complete before-state audit', () => {
  it('grades every renderer and classifies every remaining webview file exactly once', () => {
    expect(audit.components.map((row) => row.file)).toEqual(matrix.componentAuditInputs)
    const files = readdirSync(`${auditRoot}/src/webview`, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        `${entry.parentPath}/${entry.name}`.slice(auditRoot.length + 1).replaceAll('\\', '/'),
      )
      .toSorted(compareNames)
    const recorded = [...audit.components, ...audit.otherWebviewFiles].map((row) => row.file)
    expect(recorded.toSorted(compareNames)).toEqual(files)
    expect(audit.sources.map((entry) => entry.file).toSorted(compareNames)).toEqual(files)
    for (const { sha256: hash } of audit.sources) expect(hash).toMatch(/^[\da-f]{64}$/)
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
})
