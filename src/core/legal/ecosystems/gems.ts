import { compareLegalText } from '../files'
// Ruby gem evidence (M97, PLAN.md D76): `Gemfile`, `Gemfile.lock` and
// static gemspec declarations. A gemspec is Ruby code and is never
// executed: only static `name`, `version`, `license` and dependency
// assignments are read, and executable content is reported as a coverage
// gap rather than run.

import type {
  EcosystemResult,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf, dirNameOf } from '../files'

interface GemRequirement {
  readonly name: string
  readonly version: string | undefined
  readonly scope: LegalDependencyScope
  readonly file: string
}

/** `gem 'name', '>= 1.0'`: pinned versions only; ranges stay unresolved. */
function gemfileRequirement(
  line: string,
): { readonly name: string; readonly version: string | undefined } | undefined {
  const match = /^\s*gem\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/.exec(line)
  if (match?.[1] === undefined) {
    return undefined
  }
  const constraint = match[2]
  const pinned = constraint === undefined ? undefined : /^\s*=\s*(\S+)\s*$/.exec(constraint)?.[1]
  return { name: match[1], version: pinned }
}

/** Executable gemspec content: read statically, reported, never run. */
const EXECUTABLE_MARKERS = [
  '`',
  '%x(',
  'system(',
  'exec(',
  'eval(',
  'File.read',
  'IO.read',
  'require_relative',
]

function isGemspecExecutable(text: string): boolean {
  return EXECUTABLE_MARKERS.some((marker) => text.includes(marker))
}

interface GemspecStatic {
  readonly name: string | undefined
  readonly version: string | undefined
  readonly licenses: readonly string[]
  readonly dependencies: readonly { readonly name: string; readonly development: boolean }[]
}

function quotedAssignment(text: string, field: 'name' | 'version' | 'license'): string | undefined {
  const patterns = {
    name: /\.name\s*=\s*['"]([^'"]+)['"]/,
    version: /\.version\s*=\s*['"]([^'"]+)['"]/,
    license: /\.license\s*=\s*['"]([^'"]+)['"]/,
  }
  return patterns[field].exec(text)?.[1]
}

function quotedArrayAssignment(text: string): string[] {
  const body = /\.licenses\s*=\s*\[([^\]]*)\]/.exec(text)?.[1]
  if (body === undefined) {
    return []
  }
  const found: string[] = []
  const pattern = /['"]([^'"]+)['"]/g
  let match = pattern.exec(body)
  while (match !== null) {
    if (match[1] !== undefined) {
      found.push(match[1])
    }
    match = pattern.exec(body)
  }
  return found
}

/** Static gemspec assignments: names, versions, licenses, dependencies. */
function readGemspecStatic(text: string): GemspecStatic {
  const dependencies: { readonly name: string; readonly development: boolean }[] = []
  const pattern =
    /\.(add_(?:development_)?dependency)\s*\(?\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/g
  let match = pattern.exec(text)
  while (match !== null) {
    if (match[2] !== undefined) {
      dependencies.push({
        name: match[2],
        development: (match[1] ?? '').startsWith('add_development_'),
      })
    }
    match = pattern.exec(text)
  }
  const singular = quotedAssignment(text, 'license')
  const plural = quotedArrayAssignment(text)
  return {
    name: quotedAssignment(text, 'name'),
    version: quotedAssignment(text, 'version'),
    licenses: singular === undefined ? plural : [singular, ...plural],
    dependencies,
  }
}

/** `Gemfile.lock`: the GEM `specs:` entries with their locked versions. */
function readGemfileLock(text: string): { readonly name: string; readonly version: string }[] {
  const lines = text.split('\n')
  const gemIndex = lines.findIndex((line) => line.trim() === 'GEM')
  if (gemIndex === -1) {
    return []
  }
  const specsIndex = lines.findIndex((line, index) => index > gemIndex && line.trim() === 'specs:')
  if (specsIndex === -1) {
    return []
  }
  const found: { readonly name: string; readonly version: string }[] = []
  const listed1 = lines.slice(specsIndex + 1)
  for (const line of listed1) {
    if (line.trim() === '') {
      continue
    }
    if (!/^ {4}\S/.test(line)) {
      break
    }
    const entry = /^ {4}(\S+)\s+\(([^)]+)\)/.exec(line)
    if (entry?.[1] !== undefined && entry[2] !== undefined) {
      found.push({ name: entry[1], version: entry[2] })
    }
  }
  return found
}

/**
 * Read gem evidence from the snapshot. Gemspec code never runs: static
 * assignments are read and executable content becomes a coverage gap.
 */
export function readGems(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const projectLicenses: ManifestLicenseDeclaration[] = []
  const requirements: GemRequirement[] = []
  const locked = new Map<string, string>()
  const installedLicenses = new Map<
    string,
    { readonly licenseRaw: string; readonly file: string }
  >()
  let manifestFiles = 0

  const listed2 = snapshot.files
    .filter((file) => baseNameOf(file) === 'Gemfile')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed2) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    manifestFiles += 1
    let scope: LegalDependencyScope = 'production'
    const listed3 = text.split('\n')
    for (const line of listed3) {
      const trimmed = line.trim()
      if (/^group\s+:development/.test(trimmed)) {
        scope = 'development'
        continue
      }
      if (trimmed === 'end') {
        scope = 'production'
        continue
      }
      const requirement = gemfileRequirement(line)
      if (requirement !== undefined) {
        requirements.push({ ...requirement, scope, file })
      }
    }
    const dir = dirNameOf(file)
    const gemspec = snapshot.files
      .filter((candidate) => dirNameOf(candidate) === dir && candidate.endsWith('.gemspec'))
      .toSorted((a, b) => compareLegalText(a, b))[0]
    if (gemspec === undefined) continue

    const gemspecText = snapshot.readFile(gemspec)
    if (gemspecText === undefined) continue
    {
      if (isGemspecExecutable(gemspecText)) {
        incomplete.push(
          `not checked: ${gemspec} uses executable code, which never runs; only its static assignments are read`,
        )
      }
      const parsed = readGemspecStatic(gemspecText)
      if (
        parsed.licenses.length > 0 &&
        projectLicenses.every((declaration) => declaration.file !== gemspec)
      ) {
        projectLicenses.push({ raw: parsed.licenses.join(' OR '), file: gemspec })
      }
      const listed4 = parsed.dependencies
      for (const dep of listed4) {
        requirements.push({
          name: dep.name,
          version: undefined,
          scope: dep.development ? 'development' : 'production',
          file: gemspec,
        })
      }
    }
  }

  const listed5 = snapshot.files
    .filter((file) => baseNameOf(file) === 'Gemfile.lock')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed5) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed6 = readGemfileLock(text)
    for (const entry of listed6) {
      if (!locked.has(entry.name)) {
        locked.set(entry.name, entry.version)
      }
    }
  }

  const listed7 = snapshot.files
    .filter((file) => file.endsWith('.gemspec'))
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed7) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const parsed = readGemspecStatic(text)
    const isInstalled = file
      .split('/')
      .some((part) => ['vendor', 'specifications', 'gems'].includes(part))
    if (!isInstalled && projectLicenses.every((declaration) => declaration.file !== file)) {
      manifestFiles += 1
      if (parsed.licenses.length > 0)
        projectLicenses.push({ raw: parsed.licenses.join(' OR '), file })
      const listed8 = parsed.dependencies
      for (const dep of listed8)
        requirements.push({
          name: dep.name,
          version: undefined,
          scope: dep.development ? 'development' : 'production',
          file,
        })
    }
    incomplete.push(
      `not checked: ${file} is read statically; computed Ruby metadata and conditional assignments are not evaluated`,
    )
    if (parsed.name === undefined || parsed.licenses.length === 0) continue
    const base = baseNameOf(file)
    const prefix = `${parsed.name}-`
    const filenameVersion = base.startsWith(prefix)
      ? base.slice(prefix.length, -'.gemspec'.length)
      : undefined
    const version = parsed.version ?? filenameVersion
    installedLicenses.set(`${parsed.name}@${version ?? ''}`, {
      licenseRaw: parsed.licenses.join(' OR '),
      file,
    })
  }

  const names = new Map<string, GemRequirement>()
  for (const requirement of requirements) {
    if (!names.has(requirement.name)) {
      names.set(requirement.name, requirement)
    }
  }
  const lockFiles = snapshot.files
    .filter((file) => baseNameOf(file) === 'Gemfile.lock')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const [name, version] of locked) {
    if (!names.has(name)) {
      names.set(name, { name, version, scope: 'unknown', file: lockFiles[0] ?? 'Gemfile.lock' })
    }
  }

  const dependencies = Array.from(names.values(), (requirement) => {
    const version = requirement.version ?? locked.get(requirement.name)
    const present =
      version === undefined ? undefined : installedLicenses.get(`${requirement.name}@${version}`)
    return dependency('gems', present?.file ?? requirement.file, requirement.name, {
      version: requirement.version ?? locked.get(requirement.name),
      scope: requirement.scope,
      licenseRaw: present?.licenseRaw,
    })
  })

  const unresolved = dependencies.filter((dep) => dep.version === undefined).length
  if (unresolved > 0) {
    incomplete.push(
      `not checked: ${String(unresolved)} gem requirements have no locked version in any Gemfile.lock`,
    )
  }
  const withoutLicense = dependencies.filter((dep) => dep.licenseRaw === undefined).length
  if (withoutLicense > 0) {
    incomplete.push(
      `not checked: ${String(withoutLicense)} gems carry no license metadata; present gem specifications would close the gap`,
    )
  }
  if (manifestFiles === 0 && locked.size === 0) {
    incomplete.push('not checked: no Gemfile, Gemfile.lock or gemspec files found')
  }

  dependencies.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies, projectLicenses, incomplete }
}
