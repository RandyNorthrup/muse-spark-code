import { compareLegalText } from '../files'
// Cargo evidence (M97, PLAN.md D76): `Cargo.toml` manifests, `Cargo.lock`
// and present vendored crate manifests. `license` is already an SPDX
// expression; `license-file` points at a text the reader identifies.
// Nothing is built and no `build.rs` runs: path dependencies are
// first-party code and stay out of the dependency set.

import type {
  EcosystemResult,
  LegalDependencyScope,
  ManifestLicenseDeclaration,
} from '../dependencies'
import { dependency } from '../dependencies'
import type { LegalFileSnapshot } from '../files'
import { baseNameOf, hasBinaryContent, dirNameOf } from '../files'
import { identifyLicenseText } from '../projectLicense'
import {
  inlineTableField,
  parseTomlSection,
  readTomlPackageStanzas,
  tomlSectionNames,
} from './toml'

interface CargoDep {
  readonly name: string
  readonly version: string | undefined
  readonly scope: LegalDependencyScope
}

function dependencySpec(
  name: string,
  value: string,
  scope: LegalDependencyScope,
): CargoDep | undefined {
  if (!value.startsWith('{')) {
    return { name, version: value, scope }
  }
  if (value.includes('path')) {
    return undefined
  }
  const version = inlineTableField(value, 'version')
  const isOptional = /optional\s*=\s*"?true"?/.test(value)
  return { name, version, scope: isOptional ? 'optional' : scope }
}

function readManifestDeps(
  text: string,
  file: string,
): {
  readonly dependencies: readonly CargoDep[]
  readonly projectLicense: ManifestLicenseDeclaration | undefined
} {
  const found: CargoDep[] = []
  const push = (section: string, scope: LegalDependencyScope): void => {
    const table = parseTomlSection(text, section)
    for (const [name, value] of table) {
      if (typeof value !== 'string') {
        continue
      }
      const dep = dependencySpec(name, value, scope)
      if (dep !== undefined) {
        found.push(dep)
      }
    }
  }
  push('dependencies', 'production')
  push('dev-dependencies', 'development')
  push('build-dependencies', 'development')
  const listed1 = tomlSectionNames(text)
  for (const section of listed1) {
    if (section.startsWith('target.') && section.endsWith('.dependencies')) {
      push(section, 'production')
    }
  }
  const project = parseTomlSection(text, 'package')
  const license = project.get('license')
  const licenseFile = project.get('license-file')
  const dir = dirNameOf(file)
  if (typeof license === 'string' && license !== '') {
    return { dependencies: found, projectLicense: { raw: license, file } }
  }
  if (typeof licenseFile === 'string' && licenseFile !== '') {
    const target = dir === '' ? licenseFile : `${dir}/${licenseFile}`
    return { dependencies: found, projectLicense: { raw: `SEE LICENSE IN ${target}`, file } }
  }
  return { dependencies: found, projectLicense: undefined }
}

/** Present vendored metadata: crate manifests beside the lock entries. */
function readVendored(
  snapshot: LegalFileSnapshot,
  name: string,
  version: string,
): { readonly licenseRaw: string | undefined; readonly file: string | undefined } {
  const registrySuffix = `/${name}-${version}/Cargo.toml`
  const vendorSuffix = `/vendor/${name}/Cargo.toml`
  const candidate = snapshot.files
    .filter(
      (file) =>
        file.endsWith(registrySuffix) ||
        file.endsWith(vendorSuffix) ||
        file === `vendor/${name}/Cargo.toml`,
    )
    .toSorted((a, b) => compareLegalText(a, b))[0]
  if (candidate === undefined) {
    return { licenseRaw: undefined, file: undefined }
  }
  const text = snapshot.readFile(candidate)
  if (text === undefined || hasBinaryContent(text)) {
    return { licenseRaw: undefined, file: candidate }
  }
  const project = parseTomlSection(text, 'package')
  if (project.get('name') !== name || project.get('version') !== version)
    return { licenseRaw: undefined, file: candidate }
  const license = project.get('license')
  if (typeof license === 'string' && license !== '') {
    return { licenseRaw: license, file: candidate }
  }
  const licenseFile = project.get('license-file')
  if (typeof licenseFile === 'string' && licenseFile !== '') {
    const dir = dirNameOf(candidate)
    const licenseText = snapshot.readFile(`${dir}/${licenseFile}`)
    if (licenseText !== undefined && !hasBinaryContent(licenseText)) {
      return { licenseRaw: identifyLicenseText(licenseText)?.id, file: `${dir}/${licenseFile}` }
    }
  }
  return { licenseRaw: undefined, file: candidate }
}

/**
 * Read Cargo evidence from the snapshot. The lock's sourceless entries are
 * the workspace itself, not dependencies. Lock entries without vendored
 * metadata, and manifest requirements no lock resolves, stay unknown.
 */
export function readCargo(snapshot: LegalFileSnapshot): EcosystemResult {
  const incomplete: string[] = []
  const projectLicenses: ManifestLicenseDeclaration[] = []
  const manifestDeps: (CargoDep & { readonly file: string })[] = []
  const manifestFiles: string[] = []

  const listed2 = snapshot.files
    .filter((file) => baseNameOf(file) === 'Cargo.toml')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed2) {
    const segments = new Set(file.split('/'))
    if (segments.has('registry') || segments.has('vendor')) {
      continue
    }
    const text = snapshot.readFile(file)
    if (text === undefined) {
      continue
    }
    if (/\bpath\s*=/.test(text))
      incomplete.push(
        `not checked: ${file} contains path crates whose ownership and resolved metadata are unknown`,
      )
    if (/\bworkspace\s*=|\[.*dependencies\./.test(text))
      incomplete.push(
        `not checked: ${file} contains inherited or nested Cargo declarations not resolved statically`,
      )
    manifestFiles.push(file)
    const { dependencies, projectLicense } = readManifestDeps(text, file)
    manifestDeps.push(...dependencies.map((dep) => ({ ...dep, file })))
    if (projectLicense !== undefined) {
      projectLicenses.push(projectLicense)
    }
  }

  const locked = new Map<
    string,
    { readonly name: string; readonly version: string | undefined; readonly file: string }
  >()
  const listed3 = snapshot.files
    .filter((file) => baseNameOf(file) === 'Cargo.lock')
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed3) {
    if (snapshot.readFile(file) === undefined) {
      incomplete.push(`not checked: ${file} cannot be read as text`)
      continue
    }
    const listed4 = readTomlPackageStanzas(snapshot, file)
    for (const stanza of listed4) {
      if (stanza.source === undefined) {
        continue
      }
      const identity = `${stanza.name}@${stanza.version ?? ''}:${stanza.source}`
      if (!locked.has(identity))
        locked.set(identity, { name: stanza.name, version: stanza.version, file })
    }
  }

  const lockedNames = new Set(Array.from(locked.values(), (entry) => entry.name))
  const dependencies = Array.from(locked.values(), (entry) => {
    const name = entry.name
    const vendored =
      entry.version === undefined
        ? { licenseRaw: undefined, file: undefined }
        : readVendored(snapshot, name, entry.version)
    const manifest = manifestDeps.find((dep) => dep.name === name)
    return dependency('cargo', vendored.file ?? entry.file, name, {
      version: entry.version,
      scope: manifest?.scope ?? 'production',
      licenseRaw: vendored.licenseRaw,
    })
  })
  for (const manifestDep of manifestDeps) {
    if (!lockedNames.has(manifestDep.name)) {
      dependencies.push(
        dependency('cargo', manifestDep.file, manifestDep.name, {
          version: undefined,
          scope: manifestDep.scope,
        }),
      )
    }
  }

  const withoutLicense = dependencies.filter(
    (dep) => dep.version !== undefined && dep.licenseRaw === undefined,
  ).length
  if (withoutLicense > 0) {
    incomplete.push(
      `not checked: ${String(withoutLicense)} Cargo lock entries carry no license metadata in the lock and no vendored crate manifest covers them`,
    )
  }
  const unresolved = manifestDeps.filter((dep) => !lockedNames.has(dep.name)).length
  if (unresolved > 0) {
    incomplete.push(
      `not checked: ${String(unresolved)} Cargo requirements have no resolved version in any Cargo.lock`,
    )
  }
  if (manifestFiles.length === 0 && locked.size === 0) {
    incomplete.push('not checked: no Cargo manifests or locks found')
  }

  dependencies.sort((a, b) => compareLegalText(a.name, b.name))
  return { dependencies, projectLicenses, incomplete }
}
