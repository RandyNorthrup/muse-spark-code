import { fill, plural } from '../../../shared/l10n/text'
import { UI_TEXT } from '../../../shared/constants'
import type { InstalledLicenseMetadata } from '../dependencies'
import { LEGAL_HEADER_LINE_WINDOW } from '../../../shared/constants'
import { compareLegalText } from '../files'
// npm, pnpm and Yarn evidence (M97, PLAN.md D76): `package.json`
// manifests, npm locks, Yarn classic and Berry locks, `pnpm-lock.yaml`,
// and installed `node_modules` metadata already present in the
// workspace. Absent install metadata stays unknown; no install runs.

import type {
  EcosystemResult,
  LegalDependency,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency, parseJson, recordOf } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf, dirNameOf } from '../files'

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function dependenciesOf(
  manifest: Record<string, unknown>,
  field: string,
  scope: LegalDependencyScope,
  file: string,
): LegalDependency[] {
  const section = recordOf(manifest[field])
  if (section === undefined) {
    return []
  }
  const found: LegalDependency[] = Array.from(
    Object.keys(section).toSorted((a, b) => compareLegalText(a, b)),
    (name) => dependency('npm', file, name, { version: undefined, scope, licenseRaw: undefined }),
  )
  return found
}

/** Manifest requirement ranges stay versionless until a lock resolves them. */
function readManifest(
  snapshot: LegalFileSnapshot,
  file: string,
): {
  readonly dependencies: readonly LegalDependency[]
  readonly projectLicense: ManifestLicenseDeclaration | undefined
  readonly ranges: number
  readonly invalid: boolean
} {
  const text = snapshot.readFile(file)
  if (text === undefined) {
    return { dependencies: [], projectLicense: undefined, ranges: 0, invalid: false }
  }
  let parsed: unknown
  try {
    parsed = parseJson(text)
  } catch {
    return { dependencies: [], projectLicense: undefined, ranges: 0, invalid: true }
  }
  const manifest = recordOf(parsed)
  if (manifest === undefined) {
    return { dependencies: [], projectLicense: undefined, ranges: 0, invalid: true }
  }
  const found = [
    ...dependenciesOf(manifest, 'dependencies', 'production', file),
    ...dependenciesOf(manifest, 'devDependencies', 'development', file),
    ...dependenciesOf(manifest, 'optionalDependencies', 'optional', file),
    ...dependenciesOf(manifest, 'peerDependencies', 'unknown', file),
  ]
  return {
    dependencies: found,
    projectLicense: manifestLicenseOf(manifest, file),
    ranges: found.length,
    invalid: false,
  }
}

/** The manifest's own license declaration, for the project comparison. */
function manifestLicenseOf(
  manifest: Record<string, unknown>,
  file: string,
): ManifestLicenseDeclaration | undefined {
  const raw = licenseFieldOf(manifest)
  return raw === undefined ? undefined : { raw, file }
}

function readNpmLock(
  snapshot: LegalFileSnapshot,
  file: string,
  incomplete: string[],
): { readonly dependencies: readonly LegalDependency[]; readonly withoutLicense: number } {
  const text = snapshot.readFile(file)
  const lock = text === undefined ? undefined : recordOf(parseJson(text))
  const found: LegalDependency[] = []
  let withoutLicense = 0
  if (lock === undefined) {
    incomplete.push(fill(UI_TEXT.legalScanner.m171, { v0: file }))
    return { dependencies: found, withoutLicense }
  }
  if (!['1', '2', '3'].includes(String(lock['lockfileVersion']))) {
    incomplete.push(fill(UI_TEXT.legalScanner.m172, { v0: file }))
    return { dependencies: [], withoutLicense: 0 }
  }
  const packages = recordOf(lock['packages'])
  if (packages !== undefined) {
    const listed1 = Object.keys(packages).toSorted((a, b) => compareLegalText(a, b))
    for (const key of listed1) {
      if (key === '' || !key.startsWith('node_modules/')) {
        continue
      }
      const entry = recordOf(packages[key])
      if (entry === undefined) {
        continue
      }
      const name =
        stringField(entry, 'name') ??
        key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
      const version = stringField(entry, 'version')
      if (version === undefined) {
        continue
      }
      const license = stringField(entry, 'license')
      if (license === undefined) {
        withoutLicense += 1
      }
      let scope: LegalDependencyScope = 'production'
      if (Object.entries(entry).some(([field, value]) => field === 'dev' && value === true))
        scope = 'development'
      else if (entry['optional'] === true) scope = 'optional'

      found.push(dependency('npm', file, name, { version, scope, licenseRaw: license }))
    }
    return { dependencies: found, withoutLicense }
  }
  const visitLegacy = (entries: Record<string, unknown>, depth: number): void => {
    if (depth > LEGAL_HEADER_LINE_WINDOW) {
      incomplete.push(fill(UI_TEXT.legalScanner.m173, { v0: file }))
      return
    }
    const names = Object.keys(entries).toSorted((a, b) => compareLegalText(a, b))
    for (const name of names) {
      const entry = recordOf(entries[name])
      if (entry === undefined) continue
      const version = stringField(entry, 'version')
      const license = stringField(entry, 'license')
      if (license === undefined) withoutLicense += 1
      found.push(dependency('npm', file, name, { version, scope: 'unknown', licenseRaw: license }))
      const children = recordOf(entry['dependencies'])
      if (children !== undefined) visitLegacy(children, depth + 1)
    }
  }
  const legacy = recordOf(lock['dependencies'])
  if (legacy !== undefined) visitLegacy(legacy, 0)

  return { dependencies: found, withoutLicense }
}

interface YarnEntry {
  readonly name: string
  readonly version: string
}

function yarnEntryName(header: string): string | undefined {
  const first = header
    .split(',')
    .map((part) => part.trim().replaceAll(/^"|"$/g, ''))[0]
    ?.trim()
  if (first === undefined || first === '') {
    return undefined
  }
  const at = first.indexOf('@', first.startsWith('@') ? 1 : 0)
  return at <= 0 ? undefined : first.slice(0, at)
}

/** Yarn classic and Berry locks: names and versions, never licenses. */
function readYarnLock(snapshot: LegalFileSnapshot, file: string): readonly YarnEntry[] {
  const text = snapshot.readFile(file)
  if (text === undefined) {
    return []
  }
  const found: YarnEntry[] = []
  const listed3 = text.split('\n\n')
  for (const block of listed3) {
    const lines = block.split('\n')
    const header = lines[0] ?? ''
    if (!header.endsWith(':')) {
      continue
    }
    const name = yarnEntryName(header.slice(0, -1))
    if (name === undefined) {
      continue
    }
    const version =
      /^ {2}version "([^"]+)"/m.exec(block)?.[1] ?? /^ {2}version: (\S+)/m.exec(block)?.[1]
    if (version !== undefined) {
      found.push({ name, version })
    }
  }
  return found
}

/**
 * A minimal `pnpm-lock.yaml` reader: the `packages:` keys (`name@version`,
 * scoped names keep their leading `@`) carry versions; resolutions are
 * not license evidence. Anything else in the file is not read.
 */
function readPnpmLock(
  snapshot: LegalFileSnapshot,
  file: string,
): { readonly dependencies: readonly YarnEntry[]; readonly readable: boolean } {
  const text = snapshot.readFile(file)
  if (text === undefined) {
    return { dependencies: [], readable: false }
  }
  const version = /^lockfileVersion:\s*['"]?([^'"\s]+)/m.exec(text)?.[1]
  if (version !== '9.0' && version !== '9') return { dependencies: [], readable: false }
  const lines = text.split('\n')
  const packagesIndex = lines.indexOf('packages:')
  if (packagesIndex === -1) {
    return { dependencies: [], readable: false }
  }
  const found: YarnEntry[] = []
  const listed4 = lines.slice(packagesIndex + 1)
  for (const line of listed4) {
    if (line === '' || line.startsWith(' ')) {
      if (line.startsWith('  ') && line.endsWith(':') && !line.startsWith(' '.repeat(2 + 1))) {
        const key = line
          .trim()
          .slice(0, -1)
          .replaceAll(/^['"]|['"]$/g, '')
        const at = key.lastIndexOf('@')
        if (at > 0) {
          found.push({ name: key.slice(0, at), version: key.slice(at + 1) })
        }
      }
      continue
    }
    break
  }
  return { dependencies: found, readable: true }
}

/** Installed metadata already present: `node_modules` package manifests. */
function readInstalled(snapshot: LegalFileSnapshot): Map<string, InstalledLicenseMetadata> {
  const installed = new Map<string, InstalledLicenseMetadata>()
  const listed5 = snapshot.files
  for (const file of listed5) {
    if (!file.includes('node_modules/') || baseNameOf(file) !== 'package.json') {
      continue
    }
    const dir = dirNameOf(file)
    const lastModules = dir.lastIndexOf('node_modules/')
    if (lastModules === -1) {
      continue
    }
    const name = dir.slice(lastModules + 'node_modules/'.length)
    if (name === '' || (!name.includes('/') && name.startsWith('@'))) {
      continue
    }
    const text = snapshot.readFile(file)
    const manifest = text === undefined ? undefined : recordOf(parseJson(text))
    if (manifest === undefined) {
      continue
    }
    installed.set(`${name}@${stringField(manifest, 'version') ?? ''}`, {
      version: stringField(manifest, 'version'),
      licenseRaw: licenseFieldOf(manifest),
      file,
    })
  }
  return installed
}

function licenseFieldOf(manifest: Record<string, unknown>): string | undefined {
  const license = manifest['license']
  if (typeof license === 'string' && license !== '') {
    return license
  }
  if (Array.isArray(license)) {
    const parts = license.filter((part): part is string => typeof part === 'string' && part !== '')
    if (parts.length > 0) {
      return parts.join(' OR ')
    }
  }
  return undefined
}

/**
 * Read npm, pnpm and Yarn evidence from the snapshot. Requirement ranges
 * without a resolving lock, and lock entries without license or installed
 * metadata, become `not checked` coverage entries, never silent gaps.
 */
export function readNpm(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const manifests: LegalDependency[] = []
  const projectLicenses: ManifestLicenseDeclaration[] = []
  const locked = new Map<string, LegalDependency>()
  const lockedNames = new Set<string>()
  let manifestFiles = 0
  const retainEntries = (entries: readonly YarnEntry[], file: string): void => {
    for (const entry of entries) {
      lockedNames.add(entry.name)
      const identity = `${entry.name}@${entry.version}:${file}`
      if (!locked.has(identity))
        locked.set(
          identity,
          dependency('npm', file, entry.name, { version: entry.version, scope: 'unknown' }),
        )
    }
  }

  const listed6 = snapshot.files
    .filter((file) => baseNameOf(file) === 'package.json')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed6) {
    if (file.includes('node_modules/')) {
      continue
    }
    const { dependencies, projectLicense, invalid } = readManifest(snapshot, file)
    if (invalid) {
      incomplete.push(fill(UI_TEXT.legalScanner.m150, { v0: file }))
      continue
    }
    manifests.push(...dependencies)
    manifestFiles += 1
    if (projectLicense !== undefined) {
      projectLicenses.push(projectLicense)
    }
  }

  const listed7 = snapshot.files
    .filter(
      (file) =>
        baseNameOf(file) === 'package-lock.json' || baseNameOf(file) === 'npm-shrinkwrap.json',
    )
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed7) {
    const { dependencies, withoutLicense } = readNpmLock(snapshot, file, incomplete)
    for (const dep of dependencies) {
      lockedNames.add(dep.name)
      const identity = `${dep.name}@${dep.version ?? ''}:${file}:${dep.licenseRaw ?? ''}`
      if (!locked.has(identity)) {
        locked.set(identity, dep)
      }
    }
    if (withoutLicense > 0) {
      incomplete.push(
        plural(UI_TEXT.legalScanner.m174, withoutLicense, { v0: withoutLicense, v1: file }),
      )
    }
  }

  const listed8 = snapshot.files
    .filter((file) => baseNameOf(file) === 'yarn.lock')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed8) {
    const entries = readYarnLock(snapshot, file)
    retainEntries(entries, file)
    if (entries.length === 0) incomplete.push(fill(UI_TEXT.legalScanner.m175, { v0: file }))
    if (entries.length > 0) {
      incomplete.push(
        plural(UI_TEXT.legalScanner.m176, entries.length, { v0: file, v1: entries.length }),
      )
    }
  }

  const listed9 = snapshot.files
    .filter((file) => baseNameOf(file) === 'pnpm-lock.yaml')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed9) {
    const { dependencies, readable } = readPnpmLock(snapshot, file)
    if (!readable) {
      incomplete.push(fill(UI_TEXT.legalScanner.m177, { v0: file }))
      continue
    }
    retainEntries(dependencies, file)
    if (dependencies.length > 0) {
      incomplete.push(
        plural(UI_TEXT.legalScanner.m176, dependencies.length, {
          v0: file,
          v1: dependencies.length,
        }),
      )
    }
  }

  const installed = readInstalled(snapshot)
  const dependencies: LegalDependency[] = []
  const listed10 = locked.values()
  for (const dep of listed10) {
    const candidate = installed.get(`${dep.name}@${dep.version ?? ''}`)
    const present =
      dep.version !== undefined && candidate?.version === dep.version ? candidate : undefined
    if (present !== undefined && dep.licenseRaw === undefined && present.licenseRaw !== undefined) {
      dependencies.push(
        dependency('npm', present.file, dep.name, {
          version: dep.version ?? present.version,
          scope: dep.scope,
          licenseRaw: present.licenseRaw,
        }),
      )
    } else {
      dependencies.push(dep)
      if (
        present?.licenseRaw !== undefined &&
        dep.licenseRaw !== undefined &&
        present.licenseRaw !== dep.licenseRaw
      ) {
        dependencies.push(
          dependency('npm', present.file, dep.name, {
            version: dep.version,
            scope: dep.scope,
            licenseRaw: present.licenseRaw,
          }),
        )
        incomplete.push(
          fill(UI_TEXT.legalScanner.m178, {
            v0: dep.name,
            v1: dep.version ?? '',
            v2: dep.evidenceFile,
            v3: present.file,
          }),
        )
      }
    }
  }
  for (const manifestDep of manifests) {
    if (!lockedNames.has(manifestDep.name)) {
      dependencies.push(manifestDep)
    }
  }
  for (const present of installed.values()) {
    const dir = dirNameOf(present.file)
    const name = dir.slice(dir.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (dependencies.every((dep) => dep.name !== name || dep.version !== present.version)) {
      dependencies.push(
        dependency('npm', present.file, name, {
          version: present.version,
          scope: 'unknown',
          licenseRaw: present.licenseRaw,
        }),
      )
    }
  }

  const unresolved = manifests.filter((dep) => !lockedNames.has(dep.name)).length
  if (unresolved > 0) {
    incomplete.push(plural(UI_TEXT.legalScanner.m179, unresolved, { v0: unresolved }))
  }
  if (manifestFiles === 0 && locked.size === 0 && installed.size === 0) {
    incomplete.push(UI_TEXT.legalScanner.m180)
  }

  dependencies.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies, projectLicenses, incomplete }
}
