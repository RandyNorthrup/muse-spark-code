import { fill, plural } from '../../../shared/l10n/text'
import { UI_TEXT } from '../../../shared/constants'
import type { InstalledLicenseMetadata } from '../dependencies'
import { compareLegalText } from '../files'
// pip, uv and Poetry evidence (M97, PLAN.md D76): `pyproject.toml`,
// requirements files, `uv.lock`, `poetry.lock`, and present
// distribution `METADATA` and license files. Requirements without
// resolved transitive versions are incomplete; nothing is installed or
// resolved.

import type {
  EcosystemResult,
  LegalDependency,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf, dirNameOf } from '../files'
import type { TomlValue } from './toml'
import { inlineTableField, parseTomlSection, readTomlPackageStanzas } from './toml'

function pep639License(value: TomlValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** `name [extras] operator version`: the pinned version, if any. */
function requirementName(
  line: string,
): { readonly name: string; readonly version: string | undefined } | undefined {
  const cleaned = line.split(';', 1)[0]?.split('#', 1)[0]?.trim() ?? ''
  if (cleaned === '') {
    return undefined
  }
  const pinned = /^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([^;\s,]+)/.exec(cleaned)
  if (pinned?.[1] !== undefined) {
    return { name: pinned[1], version: pinned[2] }
  }
  const loose = /^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?/.exec(cleaned)
  return loose?.[1] === undefined ? undefined : { name: loose[1], version: undefined }
}

function readRequirements(
  snapshot: LegalFileSnapshot,
  file: string,
  incomplete: string[],
): LegalDependency[] {
  const text = snapshot.readFile(file)
  if (text === undefined) {
    return []
  }
  const found: LegalDependency[] = []
  let unparsable = 0
  const listed1 = text.split('\n')
  for (const raw of listed1) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    if (line.startsWith('-r ') || line.startsWith('--requirement ')) {
      const target = line.split(/\s+/, 2)[1] ?? ''
      const dir = dirNameOf(file)
      const isResolved = snapshot.files.includes(dir === '' ? target : `${dir}/${target}`)
      incomplete.push(
        fill(isResolved ? UI_TEXT.legalScanner.m185 : UI_TEXT.legalScanner.m186, {
          v0: file,
          v1: target,
        }),
      )
      continue
    }
    if (line.startsWith('-')) {
      incomplete.push(fill(UI_TEXT.legalScanner.m187, { v0: file }))
      continue
    }
    const requirement = requirementName(line)
    if (requirement === undefined) {
      unparsable += 1
      continue
    }
    found.push(
      dependency('pip', file, requirement.name, {
        version: requirement.version,
        scope: 'production',
      }),
    )
  }
  if (unparsable > 0) {
    incomplete.push(plural(UI_TEXT.legalScanner.m188, unparsable, { v0: unparsable, v1: file }))
  }
  return found
}

/** Present distribution metadata: `*.dist-info/METADATA` license fields. */
function readInstalledMetadata(snapshot: LegalFileSnapshot): Map<string, InstalledLicenseMetadata> {
  const installed = new Map<string, InstalledLicenseMetadata>()
  const listed2 = snapshot.files
  for (const file of listed2) {
    if (baseNameOf(file) !== 'METADATA' || !file.includes('.dist-info/')) {
      continue
    }
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    let name: string | undefined
    let version: string | undefined
    let expression: string | undefined
    let short: string | undefined
    const listed3 = (text.split(/\r?\n\r?\n/, 1)[0] ?? '').split('\n')
    for (const line of listed3) {
      name ??= /^Name:\s*(.+?)\s*$/.exec(line)?.[1]
      version ??= /^Version:\s*(.+?)\s*$/.exec(line)?.[1]
      expression ??= /^License-Expression:\s*(.+?)\s*$/.exec(line)?.[1]
      if (short !== undefined) continue

      const license = /^License:\s*(.+?)\s*$/.exec(line)?.[1]
      if (license !== undefined && license !== '' && license !== 'UNKNOWN') {
        short = license
      }
    }
    if (name === undefined) continue

    const licenseRaw = expression ?? (short !== undefined && short.length < 100 ? short : undefined)
    installed.set(name, { version, licenseRaw, file })
  }
  return installed
}

function requirementDependency(
  file: string,
  name: string,
  version: string | undefined,
  scope: LegalDependencyScope,
): LegalDependency {
  return dependency('pip', file, name, { version, scope })
}

/**
 * Read pip, uv and Poetry evidence from the snapshot. Lock stanzas carry
 * no license fields, so per-package licenses come from present METADATA
 * or stay unknown; requirements without pins have unresolved versions.
 */
export function readPython(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const dependencies: LegalDependency[] = []
  const projectLicenses: ManifestLicenseDeclaration[] = []

  const listed4 = snapshot.files
    .filter((file) => baseNameOf(file) === 'pyproject.toml')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed4) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const project = parseTomlSection(text, 'project')
    const poetry = parseTomlSection(text, 'tool.poetry')
    const name = project.get('name') ?? poetry.get('name')
    if (typeof name !== 'string') {
      incomplete.push(fill(UI_TEXT.legalScanner.m189, { v0: file }))
      continue
    }
    const licenseValue = project.get('license') ?? poetry.get('license')
    const fileTarget =
      typeof licenseValue === 'string' && licenseValue.startsWith('{')
        ? inlineTableField(licenseValue, 'file')
        : undefined
    const textTarget =
      typeof licenseValue === 'string' && licenseValue.startsWith('{')
        ? inlineTableField(licenseValue, 'text')
        : pep639License(licenseValue)
    if (fileTarget !== undefined) {
      const dir = dirNameOf(file)
      const target = dir === '' ? fileTarget : `${dir}/${fileTarget}`
      projectLicenses.push({ raw: `SEE LICENSE IN ${target}`, file })
    } else if (textTarget !== undefined) {
      projectLicenses.push({ raw: textTarget, file })
    }
    for (const [name, value] of parseTomlSection(text, 'tool.poetry.dependencies')) {
      if (name === 'python') continue
      const constraint = typeof value === 'string' ? value : undefined
      const version =
        constraint !== undefined && /^\d+(?:\.\d+)*$/.test(constraint) ? constraint : undefined
      dependencies.push(requirementDependency(file, name, version, 'production'))
    }
    const requirements = project.get('dependencies')
    if (requirements !== undefined && typeof requirements !== 'string') {
      for (const requirement of requirements) {
        const parsed = requirementName(requirement)
        if (parsed !== undefined) {
          dependencies.push(requirementDependency(file, parsed.name, parsed.version, 'production'))
        }
      }
    }
    const optional = parseTomlSection(text, 'project.optional-dependencies')
    const listed5 = optional.values()
    for (const group of listed5) {
      if (typeof group === 'string') {
        continue
      }
      for (const requirement of group) {
        const parsed = requirementName(requirement)
        if (parsed !== undefined) {
          dependencies.push(requirementDependency(file, parsed.name, parsed.version, 'optional'))
        }
      }
    }
  }

  const listed6 = snapshot.files
    .filter(
      (file) =>
        /^requirements(.*)\.txt$/.test(baseNameOf(file)) || baseNameOf(file) === 'requirements.in',
    )
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed6) {
    dependencies.push(...readRequirements(snapshot, file, incomplete))
  }

  const listed7 = snapshot.files
    .filter((file) => baseNameOf(file) === 'uv.lock' || baseNameOf(file) === 'poetry.lock')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed7) {
    const packages = readTomlPackageStanzas(snapshot, file)
    for (const entry of packages) {
      const existingIndex = dependencies.findIndex(
        (dep) => dep.name.toLowerCase() === entry.name.toLowerCase(),
      )
      const existing = dependencies[existingIndex]
      if (existing !== undefined && existing.version === undefined) {
        dependencies[existingIndex] = { ...existing, version: entry.version }
      }
      if (existingIndex === -1) {
        dependencies.push(
          requirementDependency(
            file,
            entry.name,
            entry.version,
            entry.optional ? 'optional' : 'production',
          ),
        )
      }
    }
    if (packages.length === 0) incomplete.push(fill(UI_TEXT.legalScanner.m190, { v0: file }))
    if (packages.length > 0) {
      incomplete.push(
        plural(UI_TEXT.legalScanner.m191, packages.length, { v0: file, v1: packages.length }),
      )
    }
  }

  const installed = readInstalledMetadata(snapshot)
  const merged = dependencies.map((dep) => {
    const candidate = [...installed].find(
      ([name]) => name.toLowerCase() === dep.name.toLowerCase(),
    )?.[1]
    const present =
      dep.version === undefined || candidate?.version === dep.version ? candidate : undefined
    if (candidate !== undefined && present === undefined)
      incomplete.push(fill(UI_TEXT.legalScanner.m192, { v0: dep.name }))
    if (present !== undefined && dep.licenseRaw === undefined && present.licenseRaw !== undefined) {
      return dependency('pip', present.file, dep.name, {
        version: dep.version ?? present.version,
        scope: dep.scope,
        licenseRaw: present.licenseRaw,
      })
    }
    return dep
  })
  for (const [name, present] of installed) {
    if (merged.every((dep) => dep.name.toLowerCase() !== name.toLowerCase())) {
      merged.push(
        dependency('pip', present.file, name, {
          version: present.version,
          scope: 'unknown',
          licenseRaw: present.licenseRaw,
        }),
      )
    }
  }

  if (
    snapshot.files.some((file) => /(?:pyproject\.toml|requirements.*\.txt|setup\.py)$/.test(file))
  ) {
    incomplete.push(UI_TEXT.legalScanner.m193)
  }
  const withoutLicense = merged.filter((dep) => dep.licenseRaw === undefined).length
  if (withoutLicense > 0)
    incomplete.push(plural(UI_TEXT.legalScanner.m194, withoutLicense, { v0: withoutLicense }))
  const unresolved = merged.filter((dep) => dep.version === undefined).length
  if (unresolved > 0) {
    incomplete.push(plural(UI_TEXT.legalScanner.m195, unresolved, { v0: unresolved }))
  }
  if (merged.length === 0 && projectLicenses.length === 0) {
    incomplete.push(UI_TEXT.legalScanner.m196)
  }

  merged.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies: merged, projectLicenses, incomplete }
}
