import { compareLegalText } from '../files'
// NuGet evidence (M97, PLAN.md D76): project declarations, central
// package versions, `packages.lock.json`, `project.assets.json` and
// present `.nuspec` license expressions. Content hashes are not license
// metadata: entries without a present nuspec stay unknown.

import type {
  EcosystemResult,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency, parseJson, recordOf } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf } from '../files'

interface NuGetReference {
  readonly name: string
  readonly version: string | undefined
}

function readPackageReferences(text: string): readonly NuGetReference[] {
  const found: NuGetReference[] = []
  const pattern = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g
  let match = pattern.exec(text)
  while (match !== null) {
    if (match[1] !== undefined) {
      found.push({ name: match[1], version: match[2] })
    }
    match = pattern.exec(text)
  }
  return found
}

function readPackagesConfig(text: string): readonly NuGetReference[] {
  const found: NuGetReference[] = []
  const pattern = /<package\s+id="([^"]+)"\s+version="([^"]+)"/g
  let match = pattern.exec(text)
  while (match !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      found.push({ name: match[1], version: match[2] })
    }
    match = pattern.exec(text)
  }
  return found
}

function readPackageVersions(text: string): Map<string, string> {
  const versions = new Map<string, string>()
  const pattern = /<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"/g
  let match = pattern.exec(text)
  while (match !== null) {
    if (match[1] !== undefined && match[2] !== undefined && !versions.has(match[1])) {
      versions.set(match[1], match[2])
    }
    match = pattern.exec(text)
  }
  return versions
}

function isTestProject(text: string): boolean {
  return /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(text)
}

interface NuspecLicense {
  readonly expression: string | undefined
}

/** A `.nuspec` license: the expression form, never a URL's guess. */
function readNuspecLicense(text: string): NuspecLicense {
  const expression = /<license\s+type="expression"\s*>([^<]+)<\/license>/.exec(text)?.[1]?.trim()
  return { expression: expression === undefined || expression === '' ? undefined : expression }
}

function readNuspecIdentity(
  text: string,
): { readonly id: string; readonly version: string | undefined } | undefined {
  const metadata = /<metadata>([\s\S]*?)<\/metadata>/.exec(text)?.[1]
  if (metadata === undefined) {
    return undefined
  }
  const id = /<id>([^<]+)<\/id>/.exec(metadata)?.[1]?.trim()
  return id === undefined || id === ''
    ? undefined
    : { id, version: /<version>([^<]+)<\/version>/.exec(metadata)?.[1]?.trim() }
}

/** `packages.lock.json`: resolved versions per framework, no licenses. */
function readPackagesLock(text: string): Map<string, string> {
  const resolved = new Map<string, string>()
  const lock = recordOf(parseJson(text))
  const dependencies = recordOf(lock?.['dependencies'])
  if (dependencies === undefined) {
    return resolved
  }
  const listed1 = Object.values(dependencies)
  for (const framework of listed1) {
    const entries = recordOf(framework)
    if (entries === undefined) {
      continue
    }
    const listed2 = Object.entries(entries)
    for (const [name, entry] of listed2) {
      const detail = recordOf(entry)
      const version =
        typeof detail?.['resolved'] === 'string' && detail['resolved'] !== ''
          ? detail['resolved']
          : undefined

      if (version !== undefined && !resolved.has(name)) {
        resolved.set(name, version)
      }
    }
  }
  return resolved
}

/** `project.assets.json`: package libraries with their versions. */
function readProjectAssets(text: string): Map<string, string> {
  const resolved = new Map<string, string>()
  const assets = recordOf(parseJson(text))
  const targets = recordOf(assets?.['targets'])
  if (targets === undefined) {
    return resolved
  }
  const listed3 = Object.values(targets)
  for (const libraries of listed3) {
    const entries = recordOf(libraries)
    if (entries === undefined) {
      continue
    }
    const listed4 = Object.entries(entries)
    for (const [key, entry] of listed4) {
      const detail = recordOf(entry)
      if (detail?.['type'] !== 'package') {
        continue
      }
      const at = key.lastIndexOf('/')
      if (at > 0 && !resolved.has(key.slice(0, at))) {
        resolved.set(key.slice(0, at), key.slice(at + 1))
      }
    }
  }
  return resolved
}

/**
 * Read NuGet evidence from the snapshot. License expressions come from
 * present `.nuspec` files only; lock and asset versions resolve
 * coordinates but never licenses.
 */
export function readNuGet(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const projectLicenses: ManifestLicenseDeclaration[] = []
  const references: (NuGetReference & {
    readonly file: string
    readonly scope: LegalDependencyScope
  })[] = []
  const centralVersions = new Map<string, string>()
  const lockedVersions = new Map<string, string>()
  const nuspecs = new Map<
    string,
    { readonly expression: string | undefined; readonly file: string }
  >()

  const listed5 = snapshot.files
    .filter(
      (file) => file.endsWith('.csproj') || file.endsWith('.props') || file.endsWith('.targets'),
    )
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed5) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const scope = isTestProject(text) ? 'development' : 'production'
    const listed6 = readPackageReferences(text)
    for (const reference of listed6) {
      references.push({ ...reference, file, scope })
    }
    const listed7 = readPackageVersions(text)
    for (const [name, version] of listed7) {
      if (!centralVersions.has(name)) {
        centralVersions.set(name, version)
      }
    }
  }

  const listed8 = snapshot.files
    .filter((file) => baseNameOf(file) === 'packages.config')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed8) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed9 = readPackagesConfig(text)
    for (const reference of listed9) {
      references.push({ ...reference, file, scope: 'production' })
    }
  }

  const listed10 = snapshot.files
    .filter((file) => baseNameOf(file) === 'packages.lock.json')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed10) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed11 = readPackagesLock(text)
    for (const [name, version] of listed11) {
      if (!lockedVersions.has(name)) {
        lockedVersions.set(name, version)
      }
    }
  }

  const listed12 = snapshot.files
    .filter((file) => baseNameOf(file) === 'project.assets.json')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed12) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed13 = readProjectAssets(text)
    for (const [name, version] of listed13) {
      if (!lockedVersions.has(name)) {
        lockedVersions.set(name, version)
      }
    }
  }

  const referenced = new Set([
    ...references.map((reference) => reference.name),
    ...lockedVersions.keys(),
  ])
  const listed14 = snapshot.files
    .filter((file) => file.endsWith('.nuspec'))
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed14) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const identity = readNuspecIdentity(text)
    if (identity === undefined) {
      continue
    }
    const { expression } = readNuspecLicense(text)
    if (!nuspecs.has(identity.id)) {
      nuspecs.set(identity.id, { expression, file })
    }
    if (
      expression !== undefined &&
      !referenced.has(identity.id) &&
      !file.split('/').includes('packages')
    ) {
      projectLicenses.push({ raw: expression, file })
    }
  }

  const dependencies = references.map((reference) => {
    const version =
      reference.version ?? centralVersions.get(reference.name) ?? lockedVersions.get(reference.name)
    const present = nuspecs.get(reference.name)
    return dependency('nuget', present?.file ?? reference.file, reference.name, {
      version,
      scope: reference.scope,
      licenseRaw: present?.expression,
    })
  })

  for (const [name, version] of lockedVersions) {
    if (dependencies.some((dep) => dep.name === name)) continue
    const present = nuspecs.get(name)
    dependencies.push(
      dependency('nuget', present?.file ?? 'packages.lock.json', name, {
        version,
        scope: 'unknown',
        licenseRaw: present?.expression,
      }),
    )
  }
  if (references.length > 0)
    incomplete.push(
      'not checked: NuGet conditional or dynamic project declarations, version ranges and multi-framework conflicts require review',
    )
  const unresolved = dependencies.filter((dep) => dep.version === undefined).length
  if (unresolved > 0) {
    incomplete.push(
      `not checked: ${String(unresolved)} NuGet requirements have no resolved version in any lock, asset or central version file`,
    )
  }
  const withoutLicense = dependencies.filter((dep) => dep.licenseRaw === undefined).length
  if (withoutLicense > 0) {
    incomplete.push(
      `not checked: ${String(withoutLicense)} NuGet packages carry no license metadata; present .nuspec files would close the gap`,
    )
  }
  if (references.length === 0 && lockedVersions.size === 0) {
    incomplete.push('not checked: no NuGet declarations, locks or asset files found')
  }

  dependencies.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies, projectLicenses, incomplete }
}
