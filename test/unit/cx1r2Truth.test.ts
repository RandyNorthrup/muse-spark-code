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

function repoFile(name: string): string {
  return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
}

const readme = repoFile('README.md')
const roadmap = repoFile('ROADMAP.md')
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

describe('RVCX1B F1: live argument claims are removed', () => {
  it('README never promises rows while arguments arrive', () => {
    expect(readme).not.toMatch(/tool rows stream|while arguments arrive|no production tool/)
    expect(readme).not.toContain('The preview shows only declared')
  })

  it('real What’s New parser excludes corrected streaming highlights', () => {
    expect(highlights('0.16.0')).not.toMatch(
      /Loop guarantees|while arguments arrive|preview fields/,
    )
  })

  it('preview metadata exists but does not establish a production capability binding', () => {
    expect(repoFile('src/core/backends/modelapi/tools.ts')).toContain('previewFields')
    expect(featureCatalog().find((feature) => feature.id === 'argument-preview')?.surfaces).toEqual(
      [],
    )
    expect(help.features.some((feature) => feature.id === 'argument-preview')).toBe(false)
  })
})

describe('RVCX1B F2: playbook panel claims are removed', () => {
  it('catalog and generated Help advertise only ACP journal/settings surfaces', () => {
    for (const features of [featureCatalog(), help.features]) {
      expect(features.find((feature) => feature.id === 'orchestrator-playbook')?.surfaces).toEqual([
        'acp:museCode',
        'acp:modelApi',
      ])
    }
  })

  it('README and current release highlights do not claim panel or Agent-map access', () => {
    expect(readme).not.toContain('The panel, Agent map, ACP and CLI read the same journal')
    expect(readme).not.toContain('Nine rules govern orchestrated work')
    expect(readme).toContain('The CLI `playbook')
    expect(highlights('0.17.0')).not.toContain('Orchestrator playbook')
  })
})

describe('RVCX1B F3: v2 schedule delivery claims are removed on every surface', () => {
  it('README retains manual /loop and drops v2 paid-fire instructions', () => {
    expect(readme).toContain('Run now')
    expect(readme).toContain('`/loop 10m Review the build`')
    expect(readme).not.toMatch(
      /schedule add --draft|--scheduled-prompts|Unattended runs are opt-in|fires running in live VS Code/,
    )
  })

  it('Help omits v2 command, settings and CLI routes after complete inventory validation', () => {
    expect(help.commands.map((command) => command.id)).not.toContain('museSpark.schedulePrompt')
    // CX1R6 keeps the switch in Help: it still controls the legacy /loop
    // shortcut, and its description says scheduled execution is unavailable.
    // The agent-creation setting has no effect yet and stays out of Help.
    const schedulesSwitch = help.settings.find((setting) => setting.id === 'museSpark.schedules')
    expect(schedulesSwitch?.description).toBe(
      'Controls the legacy /loop shortcut in Muse Code chat. Schedule management and scheduled prompt execution are unavailable.',
    )
    expect(help.settings.map((setting) => setting.id)).not.toContain(
      'museSpark.scheduleAgentCreation',
    )
    expect(help.cli.map((command) => command.route)).not.toContain('schedule')
    expect(help.cli.some((command) => command.name.includes('--scheduled-prompts'))).toBe(false)
  })

  it('compact CLI help omits v2 delivery and inactive compaction instructions', () => {
    expect(formatAcpUsage(EN, 'muse-spark-code-acp')).not.toMatch(
      /schedule add --draft|--scheduled-prompts|--no-auto-compaction/,
    )
  })

  it('plan and editor records no longer claim live-session firing or a consent failure point', () => {
    const hosts = repoFile('docs/ide-compatibility/hosts.md')
    expect(hosts).not.toMatch(/in live sessions|billed fires are refused at spend consent/)
    expect(repoFile('PLAN.md')).not.toContain('surfaces and live-session fires merged')
  })
})

describe('CX1R3 sibling sweep: dormant features have no published usage', () => {
  // Accounts left both lists with CM108ACC (cx1r4Truth pins what is published).
  it.each(['team-workers', 'vault', 'estimator', 'auto-compaction', 'argument-preview'])(
    'omits %s from Help and clears its capability inventory',
    (id) => {
      expect(help.features.some((feature) => feature.id === id)).toBe(false)
      expect(featureCatalog().find((feature) => feature.id === id)?.surfaces).toEqual([])
    },
  )

  it('retains only neutral progress text in the dormant source inventory', () => {
    for (const id of [
      'team-workers',
      'vault',
      'estimator',
      'auto-compaction',
      'argument-preview',
    ]) {
      const feature = featureCatalog().find((entry) => entry.id === id)
      expect(feature?.summary).toEqual({ ui: 'referenceInProgress' })
      expect(feature?.description).toEqual({ ui: 'referenceInProgress' })
      expect(feature?.details).toEqual([])
    }
  })

  it('removes dormant commands, options and paid availability facts', () => {
    expect(help.commands.map((command) => command.id)).not.toContain('museSpark.estimate')
    expect(
      help.cli.some((command) => ['vault', 'vaultHelp', 'estimate'].includes(command.route)),
    ).toBe(false)
    expect(help.cli.some((command) => /--vault|--no-auto-compaction/.test(command.name))).toBe(
      false,
    )
    expect(readme).not.toMatch(
      /teams of workers|Team workers default on|When a team is active|unreleased scheduler and runner adapters ship|Schedule budgets, consent and rental|P50\/P90 dates|One encrypted vault per user|Automatic compaction, its exact/,
    )
  })

  it('keeps only eight working report kind instructions', () => {
    for (const kind of [
      'playbook',
      'issues',
      'estimate',
      'fleet',
      'security',
      'accounts',
      'schedules',
    ]) {
      expect(readme).not.toContain(`/report ${kind}`)
    }
    expect(readme).toContain('/report project')
    expect(readme).toContain('/report usage')
    expect(readme).toContain('/report session')
    expect(readme).toContain('/report keybindings')
  })

  it('roadmap places dormant work in progress with no shipped note or capability claims', () => {
    const progress = roadmap.slice(roadmap.indexOf('## In progress'), roadmap.indexOf('## Planned'))
    for (const id of [
      'M96',
      'M96b',
      'M96c',
      'M96d',
      'M101',
      'M106',
      'M108',
      'M109',
      'M113',
      'M115',
      'M116',
      'M117',
    ]) {
      const row = progress.split('\n').find((line) => line.includes(`<sub>${id}</sub>`))
      expect(row).toBeDefined()
      expect(row).toMatch(/(?:is|are) in progress\./)
    }
    for (const id of ['M96', 'M96b', 'M96c', 'M96d', 'M108', 'M109', 'M115', 'M117']) {
      const row = progress.split('\n').find((line) => line.includes(`<sub>${id}</sub>`))
      expect(row).toBeDefined()
      expect(row).not.toMatch(/shipped|release|Schedule prompts|Configure|commands refuse/)
    }
    // CX1R4 F4: mixed milestones retain their working released portions and
    // release associations; only the dormant portions are in progress.
    const mixed: Readonly<Record<string, readonly RegExp[]>> = {
      M101: [
        /cache-stable/,
        /First parts shipped in 0\.15\.0/,
        /automatic compaction is in progress/,
      ],
      M106: [
        /strict tool contracts/,
        /First parts shipped in 0\.16\.0/,
        /live tool-argument previews are in progress/,
      ],
      M113: [/\/report for project/, /First parts shipped in 0\.17\.0/, /additional report kinds/],
      M116: [/\/playbook shows status/, /First parts shipped in 0\.17\.0/, /panel integration/],
    }
    for (const [id, patterns] of Object.entries(mixed)) {
      const row = progress.split('\n').find((line) => line.includes(`<sub>${id}</sub>`))
      expect(row).toBeDefined()
      for (const pattern of patterns) expect(row).toMatch(pattern)
    }
    expect(roadmap).not.toMatch(/not available yet|while arguments arrive/i)
  })

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
    expect(shown).toContain('Correction (2026-10-10)')
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

  it('M95b remains building with its open acceptance checklist', () => {
    const plan = repoFile('PLAN.md')
    const section = plan.slice(plan.indexOf('### M95b —'), plan.indexOf('### M95c —'))
    expect(section).toContain(': building.**')
    expect(section).not.toContain('**Status 2026-10-05: built.**')
  })
})
