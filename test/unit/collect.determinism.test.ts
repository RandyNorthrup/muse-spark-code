import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REPORT_KINDS } from '../../src/shared/constants'
import type { SourceSnapshot } from '../../src/core/reporting/sources/types'
import { collectFixture, facet, fixtureCollector, fullSnapshot } from './helpers/reporting/collect'
import { availableSource, reportOptions } from './helpers/reporting/snapshot'

const ROOT = path.resolve(import.meta.dirname, '../..')
const scratch = { directory: '', runner: '' }

function bytes(TZ: string, LANG: string): string {
  return execFileSync(process.execPath, [scratch.runner], { env: { TZ, LANG }, encoding: 'utf8' })
}

beforeAll(async () => {
  await mkdir(path.join(ROOT, 'temp'), { recursive: true })
  scratch.directory = await mkdtemp(path.join(ROOT, 'temp', 'm113-k-determinism-'))
  scratch.runner = path.join(scratch.directory, 'runner.cjs')
  const result = await build({
    stdin: {
      contents: `import { fixtureCollector, fullSnapshot } from './test/unit/helpers/reporting/collect'; import { reportOptions } from './test/unit/helpers/reporting/snapshot'; import { REPORT_KINDS } from './src/shared/constants'; process.stdout.write(JSON.stringify(REPORT_KINDS.map(kind => fixtureCollector(fullSnapshot(), reportOptions(kind, { scope: kind === 'milestone' ? 'M12' : kind === 'release' ? 'latest' : 'fixture-workspace' })))));`,
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  })
  await writeFile(scratch.runner, result.outputFiles[0]!.contents)
})

afterAll(async () => {
  if (scratch.directory !== '') await rm(scratch.directory, { recursive: true, force: true })
})

function reverseSnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  const source = snapshot.sources
  const plan = source.plan.data!
  const git = source.git.data!
  const session = source.session.data!
  const github = source.github.data!
  const usage = source.usage.data!
  const reverseUsage = {
    ...usage,
    breakdown: usage.breakdown.toReversed(),
    limits: usage.limits.toReversed(),
  }
  return {
    ...snapshot,
    sources: {
      ...source,
      plan: availableSource('plan', {
        ...plan,
        milestones: plan.milestones.toReversed().map((milestone) => ({
          ...milestone,
          lanes: milestone.lanes.toReversed(),
          dependencies: milestone.dependencies.toReversed(),
          checklist: milestone.checklist.toReversed(),
          requiredGates: milestone.requiredGates.toReversed(),
        })),
        questions: plan.questions.toReversed(),
        risks: plan.risks.toReversed(),
        residuals: plan.residuals.toReversed(),
        releases: plan.releases.toReversed(),
        drift: plan.drift.toReversed(),
      }),
      package: availableSource('package', {
        qualityScripts: source.package.data!.qualityScripts.toReversed(),
      }),
      git: availableSource('git', {
        ...git,
        commits: git.commits
          .toReversed()
          .map((commit) => ({ ...commit, files: commit.files.toReversed() })),
        branches: git.branches.toReversed(),
        tags: git.tags.toReversed(),
        worktrees: git.worktrees.toReversed(),
      }),
      changelog: availableSource('changelog', {
        sections: source.changelog
          .data!.sections.toReversed()
          .map((section) => ({ ...section, lines: section.lines.toReversed() })),
      }),
      certification: availableSource('certification', {
        records: source.certification
          .data!.records.toReversed()
          .map((record) => ({ ...record, checklist: record.checklist.toReversed() })),
      }),
      usage: availableSource('usage', reverseUsage),
      session: availableSource('session', {
        ...session,
        export: { ...session.export, transcript: session.export.transcript.toReversed() },
        usage: reverseUsage,
        checkRuns: session.checkRuns.toReversed(),
      }),
      questions: availableSource('questions', source.questions.data!.toReversed()),
      agentUsage: availableSource('agentUsage', source.agentUsage.data!.toReversed()),
      checkRuns: availableSource('checkRuns', source.checkRuns.data!.toReversed()),
      github: availableSource('github', {
        ...github,
        runs: github.runs.toReversed(),
        pullRequests: github.pullRequests.toReversed(),
        releases: github.releases
          .toReversed()
          .map((release) => ({ ...release, assets: release.assets.toReversed() })),
      }),
      stores: availableSource('stores', source.stores.data!.toReversed()),
      fleet: availableSource(
        'fleet',
        source.fleet
          .data!.toReversed()
          .map((section) => ({ ...section, rows: section.rows.toReversed() })),
      ),
    },
  }
}

describe('collector determinism', () => {
  it.each(REPORT_KINDS)(
    '%s repeats byte-identically and ignores source insertion order',
    (kind) => {
      const snapshot = fullSnapshot()
      const first = collectFixture(kind, {}, snapshot)
      expect(JSON.stringify(collectFixture(kind, {}, snapshot))).toBe(JSON.stringify(first))
      expect(JSON.stringify(collectFixture(kind, {}, reverseSnapshot(snapshot)))).toBe(
        JSON.stringify(first),
      )
    },
  )

  it('produces the same documents in fresh processes with different TZ and LANG', () => {
    expect(bytes('America/Los_Angeles', 'de_DE.UTF-8')).toBe(bytes('Asia/Tokyo', 'ja_JP.UTF-8'))
  })

  it('keeps row keys attached to facts while reordering capped facets', () => {
    const snapshot = fullSnapshot()
    const bindings = facet('keybindings', 'keybindings', 12)
    const forward = fixtureCollector(
      {
        ...snapshot,
        sources: { ...snapshot.sources, keybindings: availableSource('keybindings', [bindings]) },
      },
      reportOptions('keybindings'),
    )
    const reversed = fixtureCollector(
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          keybindings: availableSource('keybindings', [
            { ...bindings, rows: bindings.rows.toReversed() },
          ]),
        },
      },
      reportOptions('keybindings'),
    )
    expect(reversed).toEqual(forward)
  })

  it('guards pure collectors against ambient inputs and backend imports', async () => {
    const location = path.join(ROOT, 'src/core/reporting/collect')
    const entries = await readdir(location)
    const names = entries.filter((name) => name.endsWith('.ts'))
    for (const name of names) {
      const contents = await readFile(path.join(location, name), 'utf8')
      const file = ts.createSourceFile(name, contents, ts.ScriptTarget.Latest, true)
      const violations: string[] = []
      const visit = (node: ts.Node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
        ) {
          const module = node.moduleSpecifier.text.replaceAll('\\', '/')
          if (
            /backends|paid|vscode|node:(?:fs|http|https|os|child_process|worker_threads)/.test(
              module,
            )
          )
            violations.push(module)
        }
        if (
          ts.isPropertyAccessExpression(node) &&
          /^(?:Date\.now|Math\.random|process\.(?:env|platform|cwd)|globalThis\.(?:process|fetch))$/.test(
            node.getText(file),
          )
        )
          violations.push(node.getText(file))
        if (
          ts.isNewExpression(node) &&
          node.expression.getText(file) === 'Date' &&
          (node.arguments?.length ?? 0) === 0
        )
          violations.push('new Date')
        if (
          ts.isCallExpression(node) &&
          /(?:localeCompare|fetch|require|randomUUID|randomBytes|performance\.now)\b/.test(
            node.expression.getText(file),
          )
        )
          violations.push(node.getText(file))
        ts.forEachChild(node, visit)
      }
      visit(file)
      expect(violations, name).toEqual([])
    }
  })
})
