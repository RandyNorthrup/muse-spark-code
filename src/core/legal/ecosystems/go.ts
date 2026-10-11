import { plural } from '../../../shared/l10n/text'
import { UI_TEXT } from '../../../shared/constants'
import { compareLegalText } from '../files'
// Go module evidence (M97, PLAN.md D76): `go.mod` requirements and tool
// directives, `go.sum` versions, `vendor/modules.txt` and present
// vendored license files. Checksums alone are not license metadata: a
// version known only from `go.sum` stays unknown until vendored text
// closes the gap. Nothing is downloaded and the module cache is not read.

import type {
  EcosystemResult,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf, hasBinaryContent, isLicenseFileName } from '../files'
import { identifyLicenseText } from '../projectLicense'

interface GoRequirement {
  readonly name: string
  readonly version: string | undefined
  readonly scope: LegalDependencyScope
}

function stripComment(line: string): string {
  const cut = line.indexOf('//')
  return (cut === -1 ? line : line.slice(0, cut)).trim()
}

/** `require` and `tool` directives: single-line and block forms. */
function readGoModDirectives(text: string): {
  readonly module: string | undefined
  readonly requirements: readonly GoRequirement[]
} {
  let module: string | undefined
  const requirements: GoRequirement[] = []
  const replacements = new Map<string, string>()
  const localReplacements = new Set<string>()
  let block: 'require' | 'tool' | undefined

  const commitLine = (line: string): void => {
    const cleaned = stripComment(line)
    if (cleaned === '') {
      return
    }
    if (block === undefined) {
      const single = /^(require|tool)\s+(\S+)(?:\s+(\S+))?/.exec(cleaned)
      if (single?.[1] !== undefined && single[2] !== undefined) {
        if (single[1] === 'require' && single[3] !== undefined) {
          requirements.push({ name: single[2], version: single[3], scope: 'production' })
        } else if (single[1] === 'tool' && single[3] === undefined) {
          requirements.push({ name: single[2], version: undefined, scope: 'development' })
        }
      }
      const replace = /^replace\s+(\S+)(?:\s+\S+)?\s*=>\s*(\S+)(?:\s+(\S+))?/.exec(cleaned)
      if (replace?.[1] !== undefined && replace[2] !== undefined) {
        if (replace[2].startsWith('.') || replace[2].startsWith('/')) {
          localReplacements.add(replace[1])
        } else if (replace[3] !== undefined) {
          replacements.set(replace[1], replace[3])
        }
      }
      return
    }
    const parts = cleaned.split(/\s+/)
    const name = parts[0] ?? ''
    if (name === '' || name === ')') {
      return
    }
    if (block === 'require') {
      requirements.push({ name, version: parts[1], scope: 'production' })
    } else {
      requirements.push({ name, version: undefined, scope: 'development' })
    }
  }

  const listed1 = text.split('\n')
  for (const raw of listed1) {
    const line = raw.trim()
    module ??= /^module\s+(\S+)/.exec(line)?.[1]
    const open = /^(require|tool)\s*\($/.exec(line)?.[1]
    if (open === 'require' || open === 'tool') {
      block = open
      continue
    }
    if (line === ')') {
      block = undefined
      continue
    }
    commitLine(raw)
  }

  return {
    module,
    requirements: requirements
      .filter((requirement) => !localReplacements.has(requirement.name))
      .map((requirement) => {
        const replacement = replacements.get(requirement.name)
        return replacement === undefined ? requirement : { ...requirement, version: replacement }
      }),
  }
}

/** `go.sum` lines: module versions without any license metadata. */
function readGoSum(text: string): { readonly name: string; readonly version: string }[] {
  const found = new Map<string, string>()
  const listed2 = text.split('\n')
  for (const raw of listed2) {
    const parts = raw.trim().split(/\s+/)
    const name = parts[0] ?? ''
    const version = parts[1] ?? ''
    if (name === '' || version === '' || version.endsWith('/go.mod')) {
      continue
    }
    if (!found.has(name)) {
      found.set(name, version)
    }
  }
  return Array.from(found, ([name, version]) => ({ name, version }))
}

/** `vendor/modules.txt`: the vendored module set, `## explicit` aside. */
function readModulesTxt(text: string): { readonly name: string; readonly version: string }[] {
  const found: { readonly name: string; readonly version: string }[] = []
  const listed3 = text.split('\n')
  for (const raw of listed3) {
    const line = raw.trim()
    if (!line.startsWith('# ') || line.startsWith('## ')) {
      continue
    }
    const parts = line.slice(2).split(/\s+/)
    const name = parts[0] ?? ''
    const version = parts[1] ?? ''
    if (name !== '' && version !== '') {
      found.push({ name, version })
    }
  }
  return found
}

/** Present vendored text: `vendor/<module>/LICENSE*` read as a license. */
function readVendoredLicense(
  snapshot: LegalFileSnapshot,
  name: string,
): { readonly licenseRaw: string | undefined; readonly file: string | undefined } {
  const prefix = `vendor/${name}/`
  const candidate = snapshot.files
    .filter((file) => file.startsWith(prefix) && isLicenseFileName(file.slice(prefix.length)))
    .toSorted((a, b) => compareLegalText(a, b))[0]
  if (candidate === undefined) {
    return { licenseRaw: undefined, file: undefined }
  }
  const text = snapshot.readFile(candidate)
  return {
    licenseRaw:
      text === undefined || hasBinaryContent(text) ? undefined : identifyLicenseText(text)?.id,
    file: candidate,
  }
}

const noProjectLicenses: ManifestLicenseDeclaration[] = []

/**
 * Read Go module evidence from the snapshot. `go.mod` requirements pin
 * versions; `go.sum` alone proves a version existed, never its license;
 * vendored license texts are identified where present.
 */
export function readGo(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const requirements: (GoRequirement & { readonly file: string })[] = []
  const requirementFiles: string[] = []
  const sumVersions = new Map<string, { readonly version: string; readonly file: string }>()
  const vendored = new Map<string, string>()

  const listed4 = snapshot.files
    .filter((file) => baseNameOf(file) === 'go.mod')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed4) {
    if (file.split('/').includes('vendor')) {
      continue
    }
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    requirementFiles.push(file)
    const { requirements: directives } = readGoModDirectives(text)
    requirements.push(...directives.map((directive) => ({ ...directive, file })))
  }

  const listed5 = snapshot.files
    .filter((file) => baseNameOf(file) === 'go.sum')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed5) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed6 = readGoSum(text)
    for (const entry of listed6) {
      if (!sumVersions.has(entry.name)) {
        sumVersions.set(entry.name, { version: entry.version, file })
      }
    }
  }

  const listed7 = snapshot.files
    .filter((file) => baseNameOf(file) === 'modules.txt')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed7) {
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    const listed8 = readModulesTxt(text)
    for (const entry of listed8) {
      if (!vendored.has(entry.name)) {
        vendored.set(entry.name, entry.version)
      }
    }
  }

  const mergedRequirements = new Map<string, (typeof requirements)[number]>()
  for (const requirement of requirements) {
    const known = mergedRequirements.get(requirement.name)
    if (known === undefined) {
      mergedRequirements.set(requirement.name, requirement)
    } else {
      mergedRequirements.set(requirement.name, {
        name: requirement.name,
        version: known.version ?? requirement.version,
        scope:
          known.scope === 'development' || requirement.scope === 'development'
            ? 'development'
            : known.scope,
        file: requirement.file,
      })
    }
  }
  const dependencies = Array.from(mergedRequirements.values(), (requirement) => {
    const vendoredLicense = readVendoredLicense(snapshot, requirement.name)
    return dependency('go', vendoredLicense.file ?? requirement.file, requirement.name, {
      version:
        requirement.version ??
        vendored.get(requirement.name) ??
        sumVersions.get(requirement.name)?.version,
      scope: requirement.scope,
      licenseRaw: vendoredLicense.licenseRaw,
    })
  })
  for (const [name, entry] of sumVersions) {
    if (dependencies.every((dep) => dep.name !== name)) {
      dependencies.push(
        dependency('go', entry.file, name, { version: entry.version, scope: 'unknown' }),
      )
    }
  }

  for (const [name, version] of vendored) {
    if (dependencies.some((dep) => dep.name === name)) continue
    const local = readVendoredLicense(snapshot, name)
    dependencies.push(
      dependency('go', local.file ?? 'vendor/modules.txt', name, {
        version,
        scope: 'production',
        licenseRaw: local.licenseRaw,
      }),
    )
  }
  if (requirementFiles.length > 0) incomplete.push(UI_TEXT.legalScanner.m161)
  const checksumOnly = dependencies.filter(
    (dep) => dep.version !== undefined && dep.licenseRaw === undefined,
  ).length
  if (checksumOnly > 0) {
    incomplete.push(plural(UI_TEXT.legalScanner.m162, checksumOnly, { v0: checksumOnly }))
  }
  const unresolved = dependencies.filter((dep) => dep.version === undefined).length
  if (unresolved > 0) {
    incomplete.push(plural(UI_TEXT.legalScanner.m163, unresolved, { v0: unresolved }))
  }
  if (requirementFiles.length === 0 && sumVersions.size === 0 && vendored.size === 0) {
    incomplete.push(UI_TEXT.legalScanner.m164)
  }

  dependencies.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies, projectLicenses: noProjectLicenses, incomplete }
}
