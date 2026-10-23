// M125 lane L: the committed-profile loader, selector and status.
// Selection prefers the exact (technique, family, engine) file, then
// the newest file for the (technique, family), then the newest file
// for the (technique, engine). No file means the family is off: the
// query reports its own profile-missing, never a guess. Node only
// (reads the profile directory); the file envelope stays in shared.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  JUDGE_CALIBRATION_FAMILIES,
  JUDGE_CALIBRATION_TECHNIQUES,
  committedCalibrationFileSchema,
  type CommittedCalibrationFile,
} from '../../../shared/judgeCalibration/fileSchema'
import { parseCalibrationProfile, type CalibrationLimits, type CalibrationProfile } from './schema'

export interface CommittedCalibrationProfile {
  /** Path segments below profiles/: technique and family. */
  readonly technique: string
  readonly family: string
  readonly file: string
  readonly committedAt: string
  readonly labelSet: string
  readonly profile: CalibrationProfile
}

export interface CalibrationQuery {
  readonly technique: string
  readonly family: string
  readonly providerId: string
  readonly model: string
  readonly endpoint: string
}

export type CalibrationTier = 'exact' | 'family' | 'engine'

export interface CalibrationSelection {
  readonly tier: CalibrationTier
  readonly committed: CommittedCalibrationProfile
}

function isEngineMatch(profile: CalibrationProfile, query: CalibrationQuery): boolean {
  const identity = profile.identity
  return (
    identity.providerId === query.providerId &&
    identity.model === query.model &&
    identity.endpoint === query.endpoint
  )
}

function newestFirst(
  left: CommittedCalibrationProfile,
  right: CommittedCalibrationProfile,
): number {
  if (left.committedAt === right.committedAt) return left.file < right.file ? -1 : 1
  return left.committedAt < right.committedAt ? 1 : -1
}

/**
Select the profile a query runs under: the exact (technique, family,
engine) file, else the newest (technique, family) file, else the
newest (technique, engine) base file. Nothing matching is undefined:
the family is off.
*/
export function selectCalibrationProfile(
  committed: readonly CommittedCalibrationProfile[],
  query: CalibrationQuery,
): CalibrationSelection | undefined {
  const technique = committed.filter(
    (entry) => entry.profile.identity.technique === query.technique,
  )
  const exact = technique.find(
    (entry) =>
      entry.profile.identity.family === query.family && isEngineMatch(entry.profile, query),
  )
  if (exact !== undefined) return { tier: 'exact', committed: exact }
  const family = technique
    .filter((entry) => entry.profile.identity.family === query.family)
    .toSorted(newestFirst)
  if (family[0] !== undefined) return { tier: 'family', committed: family[0] }
  const engine = technique
    .filter((entry) => isEngineMatch(entry.profile, query))
    .toSorted(newestFirst)
  const engineBest = engine[0]
  return engineBest === undefined ? undefined : { tier: 'engine', committed: engineBest }
}

export type FamilyCalibrationStatus =
  | {
      readonly status: 'ready'
      readonly tier: CalibrationTier
      readonly technique: string
      readonly fitVersion: string
      readonly labelSet: string
      readonly committedAt: string
      readonly evidence: 'independent'
    }
  | { readonly status: 'profile-missing'; readonly family: string }

/**
What the Judge row names per family: the technique, the profile
(version, label set, date) and its evidence — or the family's own
profile-missing.
*/
export function familyCalibrationStatus(
  committed: readonly CommittedCalibrationProfile[],
  query: CalibrationQuery,
): FamilyCalibrationStatus {
  const selection = selectCalibrationProfile(committed, query)
  if (selection === undefined) return { status: 'profile-missing', family: query.family }
  return {
    status: 'ready',
    tier: selection.tier,
    technique: selection.committed.profile.identity.technique,
    fitVersion: selection.committed.profile.identity.fitVersion,
    labelSet: selection.committed.labelSet,
    committedAt: selection.committed.committedAt,
    evidence: 'independent',
  }
}

/**
Parse one committed file: the envelope, the profile body through the
calibration parser, independent evidence with measured rates, a date
no later than today, and path segments that equal the body's
technique and family. Anything else is a reason, never an exception.
*/
export function parseCommittedCalibrationFile(
  input: unknown,
  technique: string,
  family: string,
  file: string,
  today: string,
  limits: CalibrationLimits,
):
  | { readonly status: 'valid'; readonly committed: CommittedCalibrationProfile }
  | { readonly status: 'invalid'; readonly reason: string } {
  const parsed = committedCalibrationFileSchema.safeParse(input)
  if (!parsed.success) return { status: 'invalid', reason: 'invalid-envelope' }
  const envelope: CommittedCalibrationFile = parsed.data
  const profile = parseCalibrationProfile(envelope.profile, limits)
  if (profile === undefined) return { status: 'invalid', reason: 'invalid-profile' }
  if (profile.evidence !== 'independent' || profile.evaluation?.evidence !== 'independent')
    return { status: 'invalid', reason: 'weak-or-missing-evidence' }
  if (envelope.committedAt > today) return { status: 'invalid', reason: 'future-date' }
  if (technique !== profile.identity.technique || family !== profile.identity.family)
    return { status: 'invalid', reason: 'path-mismatch' }
  return {
    status: 'valid',
    committed: {
      technique,
      family,
      file,
      committedAt: envelope.committedAt,
      labelSet: envelope.labelSet,
      profile,
    },
  }
}

export interface CommittedCalibrationLoad {
  readonly profiles: readonly CommittedCalibrationProfile[]
  readonly failures: Readonly<Record<string, string>>
}

function compareNames(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Directory entries of one kind, sorted; a missing directory reads as empty. */
function readDirectoryNames(directory: string, kind: 'directory' | 'file'): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) =>
        kind === 'directory' ? entry.isDirectory() : entry.isFile() && entry.name.endsWith('.json'),
      )
      .map((entry) => entry.name)
      .toSorted(compareNames)
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw new Error(`unreadable profiles directory: ${directory}`, { cause: error })
  }
}

/** One file's JSON, or bad-json when it cannot be read or parsed. */
function readJsonFile(
  file: string,
): { readonly status: 'ok'; readonly value: unknown } | { readonly status: 'bad-json' } {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { status: 'bad-json' }
    throw new Error(`unreadable profile file: ${file}`, { cause: error })
  }
  try {
    const value: unknown = JSON.parse(text)
    return { status: 'ok', value }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return { status: 'bad-json' }
    throw new Error(`unparsable profile file: ${file}`, { cause: error })
  }
}

/**
Load profiles/<technique>/<family>/*.json. Every file must validate;
failures are reported per file with their reason. Unknown segments
are failures too: the directory holds only supported techniques and
families. Synchronous: the host loads once at startup.
*/
export function loadCommittedProfiles(
  profilesRoot: string,
  today: string,
  limits: CalibrationLimits,
): CommittedCalibrationLoad {
  const profiles: CommittedCalibrationProfile[] = []
  const failures: Record<string, string> = {}
  for (const technique of readDirectoryNames(profilesRoot, 'directory')) {
    const techniqueRoot = path.join(profilesRoot, technique)
    if (!JUDGE_CALIBRATION_TECHNIQUES.includes(technique)) {
      failures[techniqueRoot] = 'unsupported-technique'
      continue
    }
    for (const family of readDirectoryNames(techniqueRoot, 'directory')) {
      const familyRoot = path.join(techniqueRoot, family)
      if (!JUDGE_CALIBRATION_FAMILIES.includes(family)) {
        failures[familyRoot] = 'unsupported-family'
        continue
      }
      const engines = new Set<string>()
      for (const name of readDirectoryNames(familyRoot, 'file')) {
        const file = path.join(familyRoot, name)
        const read = readJsonFile(file)
        if (read.status !== 'ok') {
          failures[file] = 'invalid-json'
          continue
        }
        const parsed = read.value
        const result = parseCommittedCalibrationFile(parsed, technique, family, file, today, limits)
        if (result.status === 'invalid') {
          failures[file] = result.reason
          continue
        }
        const engine = JSON.stringify([
          result.committed.profile.identity.providerId,
          result.committed.profile.identity.model,
          result.committed.profile.identity.endpoint,
        ])
        if (engines.has(engine)) {
          failures[file] = 'duplicate-engine'
          continue
        }
        engines.add(engine)
        profiles.push(result.committed)
      }
    }
  }
  return { profiles, failures }
}
