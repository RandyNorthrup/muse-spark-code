// CX1R3: dormant features must be removed from current user-facing publication.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  contributedIds,
  parseChangelog,
  repositoryUrl,
} from '../../scripts/lib/whatsNewContent.mjs'
import manifest from '../../package.json'
import { formatAcpUsage } from '../../src/runtime/cliOptions'
import { EN } from '../../src/shared/l10n/en'
import { currentWhatsNewText } from './helpers/currentWhatsNew'
import { featureCatalog } from '../../src/shared/featureCatalog'
import { referenceModel } from '../../src/shared/reference/reference.generated'
import { metaArgumentPreviewCapabilities } from '../../src/core/backends/modelapi/modelCapabilities'

function repoFile(name: string): string {
  return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
}

const readme = repoFile('README.md')
const help = referenceModel()
const releases = parseChangelog(
  repoFile('CHANGELOG.md'),
  contributedIds(manifest),
  repositoryUrl(manifest),
)

function highlights(version: string): string {
  const release = releases.find((entry) => entry.version === version)
  expect(release).toBeDefined()
  return JSON.stringify(release?.highlights)
}

// C-M106-2 bound the selected model's record in production: the panel and ACP
// render previews on a model whose record verifies streamed arguments (today
// `muse-spark-1.3-contributor`). Headless `exec` never shows them, and the
// 0.16.0 notes keep their correction.
describe('RVCX1B F1 after C-M106-2: live argument previews are published where they render', () => {
  it('real What’s New parser excludes corrected streaming highlights', () => {
    expect(highlights('0.16.0')).not.toMatch(
      /Loop guarantees|while arguments arrive|preview fields/,
    )
  })

  it('the production entry binds the preview capability to the captured model only', () => {
    expect(repoFile('src/core/backends/modelapi/tools.ts')).toContain('previewFields')
    expect(repoFile('src/host/backend/modelApiEntry.ts')).toContain(
      'hostDeps.argumentPreviewCapabilities ?? metaArgumentPreviewCapabilities',
    )
    expect(metaArgumentPreviewCapabilities('muse-spark-1.3-contributor')).toEqual({
      tools: { streamingArguments: { state: 'yes', value: true } },
    })
    expect(metaArgumentPreviewCapabilities('muse-spark-1.3')).toBeUndefined()
    expect(featureCatalog().find((feature) => feature.id === 'argument-preview')?.surfaces).toEqual(
      ['vscode:modelApi', 'acp:modelApi'],
    )
    const row = help.features.find((feature) => feature.id === 'argument-preview')
    expect(row?.name).toEqual({ ui: 'toolArgumentPreviewLabel' })
    expect(row?.summary).toEqual({ ui: 'toolArgumentPreviewDescription' })
    expect(row?.surfaces).toEqual(['vscode:modelApi', 'acp:modelApi'])
  })
})

describe('RVCX1B F2: playbook panel claims are removed', () => {
  it('README and current release highlights do not claim panel or Agent-map access', () => {
    expect(readme).not.toContain('The panel, Agent map, ACP and CLI read the same journal')
    expect(readme).not.toContain('Nine rules govern orchestrated work')
    expect(readme).toContain('The CLI `playbook')
    expect(highlights('0.17.0')).not.toContain('Orchestrator playbook')
  })
})

describe('RVCX1B F3: v2 schedule delivery claims are removed on every surface', () => {
  it('compact CLI help omits v2 delivery and inactive compaction instructions', () => {
    expect(formatAcpUsage(EN, 'muse-spark-code-acp')).not.toMatch(
      /schedule add --draft|--scheduled-prompts|--no-auto-compaction/,
    )
  })
})

describe('CX1R3 sibling sweep: dormant features have no published usage', () => {
  it('released history has dated corrections and no dormant feature highlight or Try it', () => {
    for (const version of ['0.15.0', '0.16.0', '0.17.0']) {
      expect(highlights(version)).not.toMatch(
        /Agent roles and teams|automatic compaction|Capacity estimates|Orchestrator playbook|modelApiAutoCompaction/,
      )
    }
    expect(repoFile('CHANGELOG.md').match(/Correction \(2026-10-10\):/g)).toHaveLength(3)
  })

  it('ships encoded current notes without archived dormant claims or action buttons', () => {
    const shown = currentWhatsNewText(releases)
    expect(shown).not.toMatch(
      /no production tool declares preview fields|rows stream.*while arguments arrive|P50.*P90|ship the orchestrator-playbook skill with nine rules/i,
    )
    expect(shown).not.toContain('Capacity estimates (preview)')
    expect(shown).not.toContain('modelApiAutoCompaction')
    // What's New ships the two newest releases in full. Since 0.17.2 those are
    // 0.17.2 and 0.17.1, so no corrected release ships there any more; whenever
    // one is encoded, its dated correction comes with it.
    for (const version of ['0.15.0', '0.16.0', '0.17.0']) {
      const corrected = releases.filter((entry) => entry.version === version)
      expect(corrected).toHaveLength(1)
      expect(currentWhatsNewText(corrected)).toContain('Correction (2026-10-10)')
    }
  })

  it('still rejects invalid Try it directives in archived history', () => {
    expect(() =>
      parseChangelog(
        '## [0.17.0] - 2026-10-08\n\n### Highlights\n\n- Historical claim <!-- try: command museSpark.missing -->\n  <!-- whats-new: historical -->\n',
        contributedIds(manifest),
        repositoryUrl(manifest),
      ),
    ).toThrow('not one the manifest contributes')
  })
})
