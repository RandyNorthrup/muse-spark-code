import { compareLegalText } from '../files'
// Maven and Gradle evidence (M97, PLAN.md D76): POMs, Gradle
// declarations, lockfiles and present artifact metadata. POM license
// names are free text, so common spellings map to SPDX ids and anything
// else stays raw for a human read. Executable build logic is never
// evaluated: only declarative coordinates are read.

import type {
  EcosystemResult,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf } from '../files'
import { parseSpdxExpression } from '../spdx'

/** Common POM license spellings and their SPDX reading. */
const MAVEN_LICENSE_NAMES: ReadonlyMap<string, string> = new Map([
  ['apache license, version 2.0', 'Apache-2.0'],
  ['apache-2.0', 'Apache-2.0'],
  ['apache license 2.0', 'Apache-2.0'],
  ['mit license', 'MIT'],
  ['mit', 'MIT'],
  ['bsd 2-clause', 'BSD-2-Clause'],
  ['bsd 3-clause', 'BSD-3-Clause'],
  ['gnu general public license, version 2', 'GPL-2.0-only'],
  ['gnu general public license, version 3', 'GPL-3.0-only'],
  ['gnu lesser general public license, version 2.1', 'LGPL-2.1-only'],
  ['gnu lesser general public license, version 3', 'LGPL-3.0-only'],
  ['gnu affero general public license, version 3', 'AGPL-3.0-only'],
  ['mozilla public license, version 2.0', 'MPL-2.0'],
  ['eclipse public license, version 1.0', 'EPL-1.0'],
  ['eclipse public license, version 2.0', 'EPL-2.0'],
  ['common development and distribution license', 'CDDL-1.0'],
  ['cc0 1.0 universal', 'CC0-1.0'],
  ['the unlicense', 'Unlicense'],
  ['artistic license 2.0', 'Artistic-2.0'],
])

/** Free-text POM license names become SPDX where the mapping is exact. */
export function mavenLicenseName(text: string): string {
  const trimmed = text.trim()
  const parsed = parseSpdxExpression(trimmed)
  return parsed.ok &&
    parsed.licenses.every((license) => license.canonicalId !== undefined || license.custom)
    ? trimmed
    : (MAVEN_LICENSE_NAMES.get(trimmed.toLowerCase()) ?? trimmed)
}

type PomTag =
  'groupId' | 'artifactId' | 'version' | 'scope' | 'name' | 'dependency' | 'licenses' | 'license'

function tagContents(block: string, tag: PomTag): string | undefined {
  return blockContents(block, tag)[0]?.trim()
}

function blockContents(text: string, tag: PomTag): string[] {
  const found: string[] = []
  const opening = `<${tag}>`
  const closing = `</${tag}>`
  let offset = 0
  while (offset < text.length) {
    const start = text.indexOf(opening, offset)
    if (start === -1) break
    const content = start + opening.length
    const end = text.indexOf(closing, content)
    if (end === -1) break
    found.push(text.slice(content, end))
    offset = end + closing.length
  }
  return found
}

interface MavenDependency {
  readonly group: string
  readonly artifact: string
  readonly version: string | undefined
  readonly scope: LegalDependencyScope
}

function readPomDependencies(text: string): readonly MavenDependency[] {
  const found: MavenDependency[] = []
  const listed1 = blockContents(text, 'dependency')
  for (const block of listed1) {
    const group = tagContents(block, 'groupId')
    const artifact = tagContents(block, 'artifactId')
    if (group === undefined || artifact === undefined) {
      continue
    }
    const scope = tagContents(block, 'scope')?.toLowerCase()
    found.push({
      group,
      artifact,
      version: tagContents(block, 'version'),
      scope: scope === 'test' || scope === 'provided' ? 'development' : 'production',
    })
  }
  return found
}

/** The POM's own license names, mapped to SPDX where the mapping is exact. */
function readPomLicenses(text: string): string[] {
  const found: string[] = []
  const listed2 = blockContents(text, 'licenses')
  for (const licenses of listed2) {
    const listed3 = blockContents(licenses, 'license')
    for (const license of listed3) {
      const name = tagContents(license, 'name')
      if (name !== undefined && name !== '') {
        found.push(mavenLicenseName(name))
      }
    }
  }
  return found
}

function readPomProject(text: string): {
  readonly artifact: string | undefined
  readonly group: string | undefined
  readonly version: string | undefined
} {
  const withoutParent = text.replace(/<parent>[\s\S]*?<\/parent>/, '')
  const head = withoutParent.split('<dependencies>', 1)[0] ?? withoutParent
  return {
    artifact: tagContents(head, 'artifactId'),
    group: tagContents(head, 'groupId'),
    version: tagContents(head, 'version'),
  }
}

const GRADLE_COORDINATES =
  /^\s*(?:implementation|api|compileOnlyApi|runtimeOnly|compileOnly|testImplementation|testRuntimeOnly|testCompileOnly|androidTestImplementation)\s*(?:\(\s*)?["']([^"']+)["']/gm

function gradleScope(configuration: string): LegalDependencyScope {
  return configuration.toLowerCase().startsWith('test') ||
    configuration.toLowerCase() === 'compileonly'
    ? 'development'
    : 'production'
}

function readGradleFile(text: string): {
  readonly name: string
  readonly version: string | undefined
  readonly scope: LegalDependencyScope
}[] {
  const found: {
    readonly name: string
    readonly version: string | undefined
    readonly scope: LegalDependencyScope
  }[] = []
  GRADLE_COORDINATES.lastIndex = 0
  let match = GRADLE_COORDINATES.exec(text)
  while (match !== null) {
    const configuration = /^\s*(\w+)/.exec(match[0])?.[1] ?? 'implementation'
    const coordinates = (match[1] ?? '').split(':')
    const group = coordinates[0] ?? ''
    const artifact = coordinates[1] ?? ''
    if (group !== '' && artifact !== '' && coordinates.length >= 2) {
      found.push({
        name: `${group}/${artifact}`,
        version: coordinates[2],
        scope: gradleScope(configuration),
      })
    }
    match = GRADLE_COORDINATES.exec(text)
  }
  return found
}

/** `gradle.lockfile`: `group:name:version` lines resolving declarations. */
function readGradleLock(text: string): Map<string, string> {
  const resolved = new Map<string, string>()
  const listed4 = text.split('\n')
  for (const raw of listed4) {
    const match = /^([^#\s][^:=\s]+:[^:=\s]+):([^=\s]+)=/.exec(raw.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) {
      resolved.set(match[1].replace(':', '/'), match[2])
    }
  }
  return resolved
}

/** `gradle/libs.versions.toml` catalogs: module and version per library. */
function readVersionCatalog(text: string): Map<string, string> {
  const resolved = new Map<string, string>()
  let isInLibraries = false
  const listed5 = text.split('\n')
  for (const raw of listed5) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      isInLibraries = line === '[libraries]'
      continue
    }
    if (!isInLibraries) {
      continue
    }
    const entry = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (entry?.[1] === undefined || entry[2] === undefined) {
      continue
    }
    const module = /module\s*=\s*"([^"]+)"/.exec(entry[2])?.[1]
    const version = /version\s*=\s*"([^"]+)"/.exec(entry[2])?.[1]
    if (module !== undefined && version !== undefined) {
      resolved.set(module.replace(':', '/'), version)
    }
  }
  return resolved
}

/**
 * Read Maven and Gradle evidence from the snapshot. Dynamic versions and
 * declarations no lock or catalog resolves stay versionless; executable
 * build logic is never evaluated.
 */
export function readJvm(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const projectLicenses: ManifestLicenseDeclaration[] = []
  const poms = new Map<string, { readonly licenses: readonly string[]; readonly file: string }>()
  const retainPom = (identity: string, licenses: readonly string[], file: string): void => {
    const existing = poms.get(identity)
    if (existing !== undefined && existing.licenses.join(' OR ') !== licenses.join(' OR ')) {
      incomplete.push(
        `not checked: license metadata conflict for ${identity} between ${existing.file} and ${file}: ${existing.licenses.join(' OR ')} versus ${licenses.join(' OR ')}`,
      )
      poms.set(identity, { licenses: [], file })
    } else poms.set(identity, { licenses, file })
  }
  const manifestDeps: (MavenDependency & { readonly file: string })[] = []
  const gradleDeps: {
    readonly name: string
    readonly version: string | undefined
    readonly scope: LegalDependencyScope
    readonly file: string
  }[] = []
  const resolvedVersions = new Map<string, string>()
  let manifestFiles = 0

  const listed6 = snapshot.files
    .filter((file) => baseNameOf(file) === 'pom.xml')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed6) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    manifestFiles += 1
    const licenses = readPomLicenses(text)
    if (licenses.length > 0) {
      projectLicenses.push({ raw: licenses.join(' OR '), file })
    }
    const { artifact, group, version } = readPomProject(text)
    if (artifact !== undefined && group !== undefined && version !== undefined) {
      retainPom(`${group}/${artifact}@${version}`, licenses, file)
    }
    const listed7 = readPomDependencies(text)
    for (const dep of listed7) {
      manifestDeps.push({ ...dep, file })
    }
  }

  const listed8 = snapshot.files
    .filter(
      (file) => baseNameOf(file) === 'build.gradle' || baseNameOf(file) === 'build.gradle.kts',
    )
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed8) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    manifestFiles += 1
    incomplete.push(
      `not checked: ${file} is read statically; executable logic, catalogs and computed declarations are not evaluated`,
    )
    const listed9 = readGradleFile(text)
    for (const dep of listed9) {
      gradleDeps.push({ ...dep, file })
    }
  }

  const listed10 = snapshot.files
    .filter((file) => baseNameOf(file) === 'gradle.lockfile')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed10) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed11 = readGradleLock(text)
    for (const [name, version] of listed11) {
      if (!resolvedVersions.has(name)) {
        resolvedVersions.set(name, version)
      }
    }
  }

  const listed12 = snapshot.files
    .filter((file) => baseNameOf(file) === 'libs.versions.toml')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed12) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed13 = readVersionCatalog(text)
    for (const [name, version] of listed13) {
      if (!resolvedVersions.has(name)) {
        resolvedVersions.set(name, version)
      }
    }
  }

  const listed14 = snapshot.files
    .filter((file) => file.endsWith('.pom'))
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed14) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const { artifact, group, version } = readPomProject(text)
    if (artifact !== undefined && group !== undefined && version !== undefined) {
      retainPom(`${group}/${artifact}@${version}`, readPomLicenses(text), file)
    }
  }

  const dependencies = [
    ...manifestDeps.map((dep) => {
      const name = `${dep.group}/${dep.artifact}`
      const present = poms.get(`${name}@${dep.version ?? ''}`)
      const license =
        present === undefined || present.licenses.length === 0
          ? undefined
          : present.licenses.join(' OR ')
      return dependency(
        'maven',
        license === undefined ? dep.file : (present?.file ?? dep.file),
        name,
        {
          version: dep.version,
          scope: dep.scope,
          licenseRaw: license,
        },
      )
    }),
    ...gradleDeps.map((dep) => {
      const version = dep.version ?? resolvedVersions.get(dep.name)
      const present = poms.get(`${dep.name}@${version ?? ''}`)
      const license =
        present === undefined || present.licenses.length === 0
          ? undefined
          : present.licenses.join(' OR ')
      return dependency(
        'gradle',
        license === undefined ? dep.file : (present?.file ?? dep.file),
        dep.name,
        {
          version,
          scope: dep.scope,
          licenseRaw: license,
        },
      )
    }),
  ]

  for (const [name, version] of resolvedVersions) {
    if (dependencies.some((dep) => dep.name === name)) continue
    const present = poms.get(`${name}@${version}`)
    dependencies.push(
      dependency('gradle', present?.file ?? 'gradle.lockfile', name, {
        version,
        scope: 'unknown',
        licenseRaw:
          present === undefined || present.licenses.length === 0
            ? undefined
            : present.licenses.join(' OR '),
      }),
    )
  }
  if (manifestDeps.length > 0)
    incomplete.push(
      'not checked: Maven transitive graph, parent properties and profiles are not resolved by static POM declarations',
    )
  const unresolved = dependencies.filter((dep) => dep.version === undefined).length
  if (unresolved > 0) {
    incomplete.push(
      `not checked: ${String(unresolved)} Maven/Gradle requirements have no resolved version in any lockfile or catalog`,
    )
  }
  const withoutLicense = dependencies.filter((dep) => dep.licenseRaw === undefined).length
  if (withoutLicense > 0) {
    incomplete.push(
      `not checked: ${String(withoutLicense)} Maven/Gradle packages carry no license metadata; present artifact POMs would close the gap`,
    )
  }
  if (manifestFiles === 0 && dependencies.length === 0) {
    incomplete.push('not checked: no POMs, Gradle declarations, locks or catalogs found')
  }

  dependencies.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies, projectLicenses, incomplete }
}
