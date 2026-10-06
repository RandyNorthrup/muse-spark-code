import type {
  ReportOptions,
  ReportRow,
  ReportSection,
  ReportSourceRecord,
} from '../../../shared/reportSchema'
import type { GitFacts, PlanFacts, SourceResult, SourceSnapshot } from '../sources/types'
import {
  compare,
  count,
  isSameMilestone,
  key,
  label,
  list,
  row,
  sourcedSection,
  text,
  version,
} from './common'
import { ReportScopeNotFound, deliveryRows, laneRows, LANE_COLUMNS, nextSteps } from './plan'
import { usageSections } from './usage'

// Pure selectors need evidence absent from lane 0's facts. The reader supplies
// a bounded ancestry range and plan revision evidence, never timestamp guesses.
export interface ReportSelectionPorts {
  changes(snapshot: SourceSnapshot, options: ReportOptions): SourceResult<GitFacts['commits']>
  risksSinceRelease(snapshot: SourceSnapshot): SourceResult<Pick<PlanFacts, 'risks' | 'residuals'>>
}

function releaseInstant(at: string | null): number {
  const instant = at === null ? NaN : Date.parse(at)
  return Number.isFinite(instant) ? instant : -Infinity
}

function releaseCandidates(
  snapshot: SourceSnapshot,
): { version: string; at: string | null; sourceId: string }[] {
  return [
    ...(snapshot.sources.git.data?.tags.map((tag) => ({
      version: version(tag.name),
      at: tag.at,
      sourceId: snapshot.sources.git.record.id,
    })) ?? []),
    ...(snapshot.sources.changelog.data?.sections
      .filter((entry) => entry.version !== 'Unreleased')
      .map((entry) => ({
        version: version(entry.version),
        at: entry.date,
        sourceId: snapshot.sources.changelog.record.id,
      })) ?? []),
    ...(snapshot.sources.plan.data?.releases.map((entry) => ({
      version: version(entry.version),
      at: entry.date,
      sourceId: snapshot.sources.plan.record.id,
    })) ?? []),
    ...(snapshot.sources.github.data?.releases.map((entry) => ({
      version: version(entry.version),
      at: entry.at,
      sourceId: snapshot.sources.github.record.id,
    })) ?? []),
  ].toSorted(
    (left, right) =>
      releaseInstant(right.at) - releaseInstant(left.at) ||
      compare(left.version, right.version) ||
      compare(left.sourceId, right.sourceId) ||
      compare(left.at ?? '', right.at ?? ''),
  )
}

export function latestVersion(snapshot: SourceSnapshot): string | null {
  return releaseCandidates(snapshot)[0]?.version ?? null
}

function projectReleaseRows(snapshot: SourceSnapshot): ReportRow[] {
  const candidates = releaseCandidates(snapshot)
  const releases = new Map<string, ReportRow>()
  for (const candidate of candidates) {
    const existing = releases.get(candidate.version)
    if (existing !== undefined) {
      existing.sourceIds = [...new Set([...existing.sourceIds, candidate.sourceId])].toSorted(
        compare,
      )
      continue
    }
    releases.set(
      candidate.version,
      row(
        'release',
        [candidate.version],
        {
          version: text(candidate.version),
          date: candidate.at === null ? label('unknown') : text(candidate.at),
        },
        [candidate.sourceId],
      ),
    )
  }
  return Array.from(releases, ([, entry]) => entry)
}

export function channelRows(snapshot: SourceSnapshot, target: string | null): ReportRow[] {
  const stores = snapshot.sources.stores
  const rows =
    stores.data?.map((store) =>
      row(
        'channel',
        [store.channel],
        {
          name: text(store.channel),
          version: store.version === null ? label('unavailable') : text(store.version),
          scope: text(store.url),
          status: label(store.status),
          reason: text(store.reason ?? ''),
        },
        [stores.record.id],
      ),
    ) ?? []
  const github = snapshot.sources.github
  if (target !== null && github.data !== null) {
    const release = github.data.releases.find((entry) => version(entry.version) === target)
    rows.push(
      row(
        'channel',
        ['github'],
        {
          name: text('GitHub'),
          version: release === undefined ? label('unavailable') : text(version(release.version)),
          scope: text('GitHub'),
          status: label(release === undefined ? 'lagging' : 'current'),
          reason: text(''),
        },
        [github.record.id],
      ),
    )
  }
  return rows
}

export function ciSection(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  kind?: 'default-branch' | 'release-tag',
  ref?: string,
): ReportSection {
  const source = snapshot.sources.github
  return sourcedSection(
    snapshot,
    options,
    'ci',
    'ci',
    ['name', 'scope', 'branch', 'commit', 'outcome'],
    source.data?.runs
      .filter(
        (run) =>
          (kind === undefined || run.ref.kind === kind) &&
          (ref === undefined || version(run.ref.name) === version(ref)),
      )
      .map((run) =>
        row(
          'ci',
          [run.ref.kind, run.ref.name, run.sha, run.workflow, run.url],
          {
            name: text(run.workflow),
            scope: text(run.ref.kind),
            branch: text(run.ref.name),
            commit: text(run.sha),
            outcome: run.conclusion === null ? label('running') : text(run.conclusion),
            reason: text(run.url),
          },
          [source.record.id],
        ),
      ) ?? [],
    ['github'],
  )
}

function pullRequests(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  isMerged: boolean,
): ReportSection {
  const source = snapshot.sources.github
  return sourcedSection(
    snapshot,
    options,
    'pullRequests',
    'pullRequests',
    ['count', 'name', 'branch', 'scope'],
    source.data?.pullRequests
      .filter((pr) => (isMerged ? pr.isMerged : pr.state === 'open' && !pr.isMerged))
      .map((pr) =>
        row(
          'pr',
          [String(pr.number)],
          {
            count: count(pr.number),
            name: text(pr.title),
            branch: text(pr.headRef),
            scope: text(pr.url),
            status: pr.isMerged ? label('merged') : text(pr.state),
          },
          [source.record.id],
        ),
      ) ?? [],
    ['github'],
  )
}

export function collectProject(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  nextStepLimit: number,
  selections: ReportSelectionPorts,
): { sections: ReportSection[]; sources: ReportSourceRecord[] } {
  const plan = snapshot.sources.plan
  const facts = plan.data
  const upcoming = facts === null ? [] : nextSteps(facts, nextStepLimit)
  const milestones =
    facts?.milestones.filter(
      (milestone) =>
        ['building', 'built', 'certified', 'waiting'].includes(milestone.status) ||
        upcoming.some((entry) => isSameMilestone(entry.id, milestone.id)),
    ) ?? []
  const release = latestVersion(snapshot)
  const risks = selections.risksSinceRelease(snapshot)
  const sections = [
    sourcedSection(
      snapshot,
      options,
      'releases',
      'releases',
      ['version', 'date'],
      projectReleaseRows(snapshot),
      ['changelog', 'git', 'plan', 'github'],
    ),
    sourcedSection(
      snapshot,
      options,
      'channels',
      'channels',
      ['name', 'version', 'scope'],
      channelRows(snapshot, release),
      ['stores', 'github'],
    ),
    sourcedSection(
      snapshot,
      options,
      'milestones',
      'milestones',
      ['name', 'goal', 'date'],
      milestones.map((milestone) =>
        row(
          'milestone',
          [milestone.id],
          {
            name: text(milestone.id),
            goal: text(milestone.title),
            date: text(milestone.date),
            status: label(milestone.status),
          },
          [plan.record.id],
        ),
      ),
      ['plan'],
    ),
    sourcedSection(
      snapshot,
      options,
      'lanes',
      'lanes',
      LANE_COLUMNS,
      laneRows(milestones, plan.record.id),
      ['plan', 'git', 'certification'],
    ),
    pullRequests(snapshot, options, false),
    ciSection(snapshot, options, 'default-branch'),
    ...usageSections(snapshot, options, 'usage'),
    sourcedSection(
      snapshot,
      options,
      'risks',
      'risks',
      ['name', 'reason'],
      [
        ...(risks.data?.risks.map((risk) =>
          row('risk', [risk.id], { name: text(risk.id), reason: text(risk.text) }, [
            risks.record.id,
          ]),
        ) ?? []),
        ...(risks.data?.residuals.map((residual) =>
          row('residual', [residual.id], { name: text(residual.id), reason: text(residual.text) }, [
            risks.record.id,
          ]),
        ) ?? []),
      ],
      [],
      [risks.record],
    ),
    sourcedSection(
      snapshot,
      options,
      'nextSteps',
      'nextSteps',
      ['name', 'dependencies', 'reason'],
      facts === null ? [] : deliveryRows(facts, nextStepLimit, plan.record.id),
      ['plan'],
    ),
  ]
  return { sections, sources: [risks.record] }
}

export function collectRelease(snapshot: SourceSnapshot, options: ReportOptions): ReportSection[] {
  const target = options.scope === 'latest' ? latestVersion(snapshot) : version(options.scope)
  const changelog = snapshot.sources.changelog
  const git = snapshot.sources.git
  const plan = snapshot.sources.plan
  const github = snapshot.sources.github
  const requiredSources = [changelog, git, plan, github]
  const unresolvedSources = requiredSources.filter((source) => source.record.status !== 'ok')
  const observed = releaseCandidates(snapshot).filter((entry) => entry.version === target)
  const entries =
    changelog.data?.sections.filter((entry) => version(entry.version) === target) ?? []
  const tags = git.data?.tags.filter((entry) => version(entry.name) === target) ?? []
  const records = plan.data?.releases.filter((entry) => version(entry.version) === target) ?? []
  if (unresolvedSources.length === 0 && observed.length === 0) {
    throw new ReportScopeNotFound(
      options.scope,
      [
        ...new Set([
          ...(changelog.data?.sections.map((entry) => entry.version) ?? []),
          ...(git.data?.tags.map((entry) => entry.name) ?? []),
          ...(plan.data?.releases.map((entry) => entry.version) ?? []),
          ...(github.data?.releases.map((entry) => entry.version) ?? []),
        ]),
      ].toSorted(compare),
    )
  }
  return [
    sourcedSection(
      snapshot,
      options,
      'releaseEvidence',
      'releases',
      ['version', 'sources'],
      [
        row(
          'release-evidence',
          [options.scope],
          {
            version: target === null ? label('unknown') : text(target),
            status: label(observed.length === 0 ? 'unknown' : 'ok'),
            sources: list(unresolvedSources.map((source) => source.record.id)),
          },
          observed.length === 0
            ? requiredSources.map((source) => source.record.id)
            : observed.map((entry) => entry.sourceId),
        ),
      ],
      ['changelog', 'git', 'plan', 'github'],
    ),
    sourcedSection(
      snapshot,
      options,
      'changelog',
      'changelog',
      ['name'],
      entries.flatMap((entry) =>
        [...new Set(entry.lines)].map((line) =>
          row('line', [entry.version, line], { name: text(line) }, [changelog.record.id]),
        ),
      ),
      ['changelog'],
    ),
    sourcedSection(
      snapshot,
      options,
      'tag',
      'tag',
      ['name', 'commit', 'date'],
      tags.map((tag) =>
        row(
          'tag',
          [tag.name],
          {
            name: text(tag.name),
            commit: text(tag.commit),
            date: { type: 'timestamp', value: tag.at },
          },
          [git.record.id],
        ),
      ),
      ['git'],
    ),
    sourcedSection(
      snapshot,
      options,
      'channels',
      'channels',
      ['name', 'version', 'scope'],
      channelRows(snapshot, target),
      ['stores', 'github'],
    ),
    sourcedSection(
      snapshot,
      options,
      'releaseRecord',
      'releaseRecord',
      ['version', 'date', 'name'],
      records.map((record) =>
        row(
          'release',
          [record.version],
          { version: text(record.version), date: text(record.date), name: text(record.text) },
          [plan.record.id],
        ),
      ),
      ['plan'],
    ),
    sourcedSection(
      snapshot,
      options,
      'assets',
      'releases',
      ['name', 'files', 'commit', 'date'],
      github.data?.releases
        .filter((entry) => version(entry.version) === target)
        .map((entry) =>
          row(
            'release',
            [entry.version],
            {
              name: text(entry.version),
              files: list(entry.assets),
              commit: text(entry.commit),
              date: { type: 'timestamp', value: entry.at },
            },
            [github.record.id],
          ),
        ) ?? [],
      ['github'],
    ),
    ciSection(snapshot, options, 'release-tag', target ?? undefined),
  ]
}

function fileArea(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/')
  const root = parts[0] ?? ''
  if (root === 'src') {
    const area = parts.slice(0, 2)
    if (
      (parts[1] === 'runtime' && parts[2] === 'exec') ||
      (parts[1] === 'shared' && parts[2] === 'l10n')
    )
      area.push(parts[2])
    return area.join('/')
  }
  if (['native', 'test', 'action'].includes(root) && parts.length > 2)
    return parts.slice(0, 2).join('/')
  return root === 'docs' &&
    ['certification', 'ide-compatibility', 'schemas'].includes(parts[1] ?? '')
    ? parts.slice(0, 2).join('/')
    : root
}

export function collectChanges(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  selections: ReportSelectionPorts,
): { sections: ReportSection[]; sources: ReportSourceRecord[] } {
  const selected = selections.changes(snapshot, options)
  const changelog = snapshot.sources.changelog
  const files = new Map<string, Set<string>>()
  const commits = selected.data ?? []
  for (const commit of commits) {
    for (const file of commit.files) {
      const area = fileArea(file)
      const names = files.get(area) ?? new Set<string>()
      names.add(file.replaceAll('\\', '/'))
      files.set(area, names)
    }
  }
  return {
    sections: [
      sourcedSection(
        snapshot,
        options,
        'commits',
        'commits',
        ['milestones', 'commit', 'date', 'name'],
        selected.data?.map((commit) => {
          const branches =
            snapshot.sources.git.data?.branches
              .filter((branch) => branch.commit === commit.sha)
              .map((branch) => branch.name) ?? []
          const milestones = [
            ...commit.subject.matchAll(/\bM\d+[a-z]*\d*\b/gi),
            ...branches.join(' ').matchAll(/(?:feature\/|\b)m\d+[a-z]*\d*/gi),
          ].map((match) => match[0].replace(/^feature\//, '').toUpperCase())
          return row(
            key('commit-group', milestones.toSorted(compare)[0] ?? 'unknown'),
            [commit.sha],
            {
              milestones: list(milestones),
              commit: text(commit.sha),
              date: { type: 'timestamp', value: commit.at },
              name: text(commit.subject),
            },
            [selected.record.id],
          )
        }) ?? [],
        [],
        [selected.record],
      ),
      sourcedSection(
        snapshot,
        options,
        'files',
        'files',
        ['scope', 'count', 'files'],
        [...files].map(([area, names]) =>
          row(
            'area',
            [area],
            { scope: text(area), count: count(names.size), files: list([...names]) },
            [selected.record.id],
          ),
        ),
        [],
        [selected.record],
      ),
      sourcedSection(
        snapshot,
        options,
        'changelog',
        'changelog',
        ['name'],
        changelog.data?.sections
          .filter((entry) => entry.version === 'Unreleased')
          .flatMap((entry) =>
            [...new Set(entry.lines)].map((line) =>
              row('line', [line], { name: text(line) }, [changelog.record.id]),
            ),
          ) ?? [],
        ['changelog'],
      ),
      pullRequests(snapshot, options, true),
    ],
    sources: [selected.record],
  }
}
