import { compareLegalText } from '../files'
// Composer evidence (M97, PLAN.md D76): `composer.json`, `composer.lock`
// and present `installed.json` metadata. The lock carries per-package
// licenses, the richest of the manifest formats; arrays of licenses read
// as an `OR` choice. Nothing is installed.

import type {
  EcosystemResult,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency, parseJson, recordOf } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf } from '../files'

function licenseOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') {
    return value
  }
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === 'string' && part !== '')
    if (parts.length > 0) {
      return parts.join(' OR ')
    }
  }
  return undefined
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

interface ComposerPackage {
  readonly name: string
  readonly version: string | undefined
  readonly licenseRaw: string | undefined
}

/** One package entry of `composer.lock` or `installed.json`. */
function readLockPackage(entry: unknown): ComposerPackage | undefined {
  const record = recordOf(entry)
  const name = stringField(record ?? {}, 'name')
  if (record === undefined || name === undefined) {
    return undefined
  }
  return name === 'php' ||
    name === 'hhvm' ||
    name === 'composer-runtime-api' ||
    name.startsWith('ext-') ||
    name.startsWith('lib-')
    ? undefined
    : { name, version: stringField(record, 'version'), licenseRaw: licenseOf(record['license']) }
}

function readRequirements(
  manifest: Record<string, unknown>,
  field: string,
  scope: LegalDependencyScope,
): (ComposerPackage & { readonly scope: LegalDependencyScope })[] {
  const section = recordOf(manifest[field])
  if (section === undefined) {
    return []
  }
  const found: (ComposerPackage & { readonly scope: LegalDependencyScope })[] = []
  const listed1 = Object.keys(section).toSorted((a, b) => compareLegalText(a, b))
  for (const name of listed1) {
    if (name === 'php' || name === 'hhvm' || name.startsWith('ext-') || name.startsWith('lib-')) {
      continue
    }
    found.push({ name, version: undefined, licenseRaw: undefined, scope })
  }
  return found
}

/**
 * Read Composer evidence from the snapshot. Platform requirements
 * (`php`, `ext-*`) are the runtime, not distributed packages.
 */
export function readComposer(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const projectLicenses: ManifestLicenseDeclaration[] = []
  const requirements: (ComposerPackage & {
    readonly scope: LegalDependencyScope
    readonly file: string
  })[] = []
  const locked = new Map<
    string,
    ComposerPackage & { readonly file: string; readonly scope: LegalDependencyScope }
  >()
  const installed = new Map<string, ComposerPackage & { readonly file: string }>()
  let manifestFiles = 0

  const listed2 = snapshot.files
    .filter((file) => baseNameOf(file) === 'composer.json')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed2) {
    const text = snapshot.readFile(file)
    const manifest = text === undefined ? undefined : recordOf(parseJson(text))
    if (manifest === undefined) {
      if (text !== undefined) {
        incomplete.push(
          `not checked: ${file} is not valid JSON, so its requirements and license are unknown`,
        )
      }
      continue
    }
    manifestFiles += 1
    const license = licenseOf(manifest['license'])
    if (license !== undefined) {
      projectLicenses.push({ raw: license, file })
    }
    const listed3 = readRequirements(manifest, 'require', 'production')
    for (const entry of listed3) {
      requirements.push({ ...entry, file })
    }
    const listed4 = readRequirements(manifest, 'require-dev', 'development')
    for (const entry of listed4) {
      requirements.push({ ...entry, file })
    }
  }

  const listed5 = snapshot.files
    .filter((file) => baseNameOf(file) === 'composer.lock')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed5) {
    const text = snapshot.readFile(file)
    const lock = text === undefined ? undefined : recordOf(parseJson(text))
    if (lock === undefined) {
      if (text !== undefined) {
        incomplete.push(
          `not checked: ${file} is not valid JSON, so its locked versions are unknown`,
        )
      }
      continue
    }
    const listed6 = ['packages', 'packages-dev'] as const
    for (const section of listed6) {
      const entries = lock[section]
      if (!Array.isArray(entries)) {
        continue
      }
      for (const entry of entries) {
        const parsed = readLockPackage(entry)
        if (parsed !== undefined && !locked.has(parsed.name)) {
          locked.set(parsed.name, {
            ...parsed,
            file,
            scope: section === 'packages-dev' ? 'development' : 'production',
          })
        }
      }
    }
  }

  const listed7 = snapshot.files
    .filter((file) => baseNameOf(file) === 'installed.json')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed7) {
    const text = snapshot.readFile(file)
    const parsed = text === undefined ? undefined : parseJson(text)
    const entries = Array.isArray(parsed) ? parsed : recordOf(parsed)?.['packages']
    if (!Array.isArray(entries)) {
      continue
    }
    for (const entry of entries) {
      const parsedEntry = readLockPackage(entry)
      if (
        parsedEntry !== undefined &&
        !installed.has(`${parsedEntry.name}@${parsedEntry.version ?? ''}`)
      ) {
        installed.set(`${parsedEntry.name}@${parsedEntry.version ?? ''}`, { ...parsedEntry, file })
      }
    }
  }

  const dependencies = Array.from(locked.values(), (entry) => {
    const present =
      entry.version === undefined ? undefined : installed.get(`${entry.name}@${entry.version}`)
    const licenseRaw = entry.licenseRaw ?? present?.licenseRaw
    const manifest = requirements.find((requirement) => requirement.name === entry.name)
    return dependency(
      'composer',
      entry.licenseRaw === undefined && present?.licenseRaw !== undefined
        ? present.file
        : entry.file,
      entry.name,
      {
        version: entry.version,
        scope: manifest?.scope ?? entry.scope,
        licenseRaw,
      },
    )
  })
  for (const requirement of requirements) {
    if (
      !locked.has(requirement.name) &&
      dependencies.every((dep) => dep.name !== requirement.name)
    ) {
      dependencies.push(
        dependency('composer', requirement.file, requirement.name, {
          version: undefined,
          scope: requirement.scope,
        }),
      )
    }
  }

  const listed8 = locked.values()
  for (const entry of listed8) {
    const present =
      entry.version === undefined ? undefined : installed.get(`${entry.name}@${entry.version}`)
    if (!(
      present?.licenseRaw !== undefined &&
      entry.licenseRaw !== undefined &&
      present.licenseRaw !== entry.licenseRaw &&
      present.version === entry.version
    )) {
      continue
    }

    dependencies.push(
      dependency('composer', present.file, entry.name, {
        version: entry.version,
        scope: entry.scope,
        licenseRaw: present.licenseRaw,
      }),
    )
    incomplete.push(
      `not checked: license evidence conflict for ${entry.name} between ${entry.file} and ${present.file}`,
    )
  }
  const unresolved = dependencies.filter((dep) => dep.version === undefined).length
  if (unresolved > 0) {
    incomplete.push(
      `not checked: ${String(unresolved)} Composer requirements have no locked version in any composer.lock`,
    )
  }
  const withoutLicense = dependencies.filter((dep) => dep.licenseRaw === undefined).length
  if (withoutLicense > 0) {
    incomplete.push(
      `not checked: ${String(withoutLicense)} Composer packages carry no license metadata in the lock or installed data`,
    )
  }
  if (manifestFiles === 0 && locked.size === 0) {
    incomplete.push('not checked: no composer.json, composer.lock or installed.json found')
  }

  dependencies.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies, projectLicenses, incomplete }
}
