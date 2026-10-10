// RVCX1 truth fixes (lane CX1R2): release text must match code behavior.
// Each test reads the shipped file and fails while the overclaim is present.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  contributedIds,
  parseChangelog,
  repositoryUrl,
} from '../../scripts/lib/whatsNewContent.mjs'
import manifest from '../../package.json'
import { EN } from '../../src/shared/l10n/en'

function repoFile(name: string): string {
  return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
}

function playbookRow(source: string): string {
  const hit = source.indexOf('Orchestrator playbook')
  expect(hit).toBeGreaterThan(-1)
  return source.slice(hit, hit + 400)
}

function m95bSection(): string {
  const plan = repoFile('PLAN.md')
  const start = plan.indexOf('### M95b —')
  const end = plan.indexOf('### M95c —')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return plan.slice(start, end)
}

describe('RVCX1 F1: 0.16.0 argument-preview claims carry a today-qualification', () => {
  const releases = parseChangelog(
    repoFile('CHANGELOG.md'),
    contributedIds(manifest),
    repositoryUrl(manifest),
  )
  const sixteen = releases.find((release) => release.version === '0.16.0')
  const shown = JSON.stringify(sixteen?.highlights ?? [])

  it("What's New (built from the 0.16.0 Highlights) says the text is not shown yet", () => {
    expect(sixteen).toBeDefined()
    expect(shown).toContain('not shown yet')
  })

  it('the 0.16.0 Highlights no longer promise streamed argument previews', () => {
    expect(shown).not.toContain('argument previews')
  })

  it('the README Earlier-in-0.16.0 highlight matches the CHANGELOG wording', () => {
    const readme = repoFile('README.md')
    const start = readme.indexOf('### Earlier in 0.16.0')
    const end = readme.indexOf('### Earlier in 0.15.0')
    const section = readme.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(section).toContain('argument text is not shown yet')
    expect(section).not.toContain('streamed\n  argument previews help you follow')
  })
})

describe('RVCX1 F2: estimator Help carries the unavailable qualification', () => {
  it('the reference title says /estimate waits on the plan-reader binding', () => {
    expect(EN.referenceEstimate).toContain('Not available yet')
    expect(EN.referenceEstimate).toContain('/estimate waits on the plan-reader binding')
  })

  it('the estimator detail names the production refusal', () => {
    expect(EN.estimateCliHelp).toContain('M117-W-M113-plan-reader')
  })

  it('the generated reference shows both qualifications', () => {
    const reference = repoFile('docs/reference.md')
    const start = reference.indexOf('### Estimator')
    const end = reference.indexOf('### Support')
    const section = reference.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(section).toContain('/estimate waits on the plan-reader binding')
    expect(section).toContain('M117-W-M113-plan-reader')
  })

  it('the README no longer says the plan reader comes later', () => {
    const readme = repoFile('README.md')
    expect(readme).not.toContain('the plan reader that\n  comes later')
    expect(readme).not.toContain('until the plan reader lands')
    expect(readme).toContain('the reader is on main but unbound')
  })
})

describe('RVCX1 F3: playbook roadmap row qualifies the pending panel enforcement', () => {
  it('entries.json no longer says the skill governs panel dispatches', () => {
    const entries = repoFile('docs/roadmap/entries.json')
    expect(entries).not.toContain("governs the panel's subagent")
    expect(playbookRow(entries)).toContain('stays pending')
  })

  it('ROADMAP.md carries the same qualification', () => {
    expect(playbookRow(repoFile('ROADMAP.md'))).toContain('stays pending')
  })

  it('the README playbook highlight says the panel does not enforce them yet', () => {
    const readme = repoFile('README.md')
    expect(readme).toContain('the VS Code panel does not enforce them yet')
    expect(readme).not.toContain('`/settings` answer locally; the VS Code panel follows.')
  })

  it('the released 0.17.0 Highlights (shipped What’s New) qualify the panel', () => {
    const changelog = repoFile('CHANGELOG.md')
    const releases = parseChangelog(changelog, contributedIds(manifest), repositoryUrl(manifest))
    const seventeen = releases.find((release) => release.version === '0.17.0')
    const shown = JSON.stringify(seventeen?.highlights ?? [])
    expect(seventeen).toBeDefined()
    expect(shown).toContain('the VS Code panel does not enforce them yet')
    expect(shown).not.toContain('the VS Code panel follows.')
  })
})

describe('RVCX1 sweep: teams highlights say teams cannot be created yet', () => {
  it('the released 0.15.0 Highlights (shipped What’s New) carry the qualification', () => {
    const changelog = repoFile('CHANGELOG.md')
    const releases = parseChangelog(changelog, contributedIds(manifest), repositoryUrl(manifest))
    const fifteen = releases.find((release) => release.version === '0.15.0')
    const shown = JSON.stringify(fifteen?.highlights ?? [])
    expect(fifteen).toBeDefined()
    expect(shown).toContain('teams of workers in isolated workspaces cannot be created yet')
  })

  it('the README Earlier-in-0.15.0 highlight matches', () => {
    const readme = repoFile('README.md')
    const start = readme.indexOf('### Earlier in 0.15.0')
    const end = readme.indexOf('### Earlier in 0.14.5')
    const section = readme.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(section).toContain('teams of workers in isolated workspaces cannot be created yet')
  })
})

describe('RVCX1 F4: M95b status matches its open checklist', () => {
  it('M95b is building with explicit remainders, not built', () => {
    const section = m95bSection()
    expect(section).not.toContain('**Status 2026-10-05: built.**')
    expect(section).toContain(': building.**')
    expect(section).toContain('0.15.0 preview')
  })

  it('the C-X-1 certification no longer says nothing shipped for M95b', () => {
    const cert = repoFile('docs/certification/cx1.md')
    expect(cert).not.toContain('M95b/M95c stay\n  `planned` (nothing shipped)')
    expect(cert).not.toContain('M95b/M95c stay `planned` (nothing shipped)')
    expect(cert).toContain('M95b `planned` → `building`')
  })
})
