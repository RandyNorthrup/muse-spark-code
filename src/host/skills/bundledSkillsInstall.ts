// The bundled skills for Muse Code (M89, PLAN.md D68). Muse Code reads only
// its own skill folders, so Install copies the package vendored inside the
// extension to `<config home>/muse/skill-sources/high-quality-projects-skill/`,
// marks the copy as the extension's (`.muse-spark-bundled.json`: the tag and
// when), and links each skill into Muse Code's personal skills folder,
// `<config home>/muse/skills/<id>`: a junction on Windows, a directory symlink
// elsewhere, as the package's own install guide prescribes. Update is the
// same install over the extension's own copy; Remove deletes the links that
// lead into the marked copy, then the copy.
//
// What it never does: replace or remove a folder without the mark, touch a
// skill folder of the user's (an id already taken is left alone and named),
// follow or delete a link that leads anywhere but into the marked copy, or
// write outside those two folders. The copy goes to a work folder beside
// the target first and is renamed in, and a failed install removes what it
// made. Built into dist/bundledSkills.js and loaded on first use (PLAN.md
// D6); every result is data, worded by the activation side.

import { createHash, type Hash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { redactSecrets } from '../../core/redact'
import * as z from 'zod/mini'
import {
  BUNDLED_SKILLS_ARCHIVE_FILE,
  BUNDLED_SKILLS_ARCHIVE_MAX_BYTES,
  BUNDLED_SKILLS_ARCHIVE_MEMBER_MAX_BYTES,
  BUNDLED_SKILLS_ARCHIVE_VERSION,
  BUNDLED_SKILLS_DIR,
  BUNDLED_SKILLS_LICENSE_FILE,
  BUNDLED_SKILLS_MARKER_FILE,
  BUNDLED_SKILLS_PACKAGE_NAME,
  BUNDLED_SKILLS_RETIRED_WORD,
  BUNDLED_SKILLS_STAGING_WORD,
  BUNDLED_SKILLS_VENDOR_FILE,
  EXTENSION_QUALIFIED_ID,
  FIRST_PARTY_SKILLS_DIR,
  SKILL_FILE_NAME,
  SKILL_ID_PATTERN,
} from '../../shared/constants'
import { parseSolidTextArchive, solidMemberBytes } from '../../core/archives/solidTextArchive'

export interface BundledSkillsPaths {
  /** The vendored package inside the installed extension. */
  readonly vendorRoot: string
  /** Muse Code's personal skills folder, `<config home>/muse/skills`. */
  readonly skillsRoot: string
  /** Its sibling `<config home>/muse/skill-sources`, where the copy goes. */
  readonly sourcesRoot: string
  /**
  The installed extension's own `skills/` (M97): its skills link straight
  at the extension, with no copy and no tag. Absent where none ship.
  */
  readonly extensionSkillsRoot?: string | undefined
}

/** How a link is made: Node's `fs.symlink`, unless a test watches the calls. */
export type MakeLink = (target: string, link: string, type: 'junction' | 'dir') => Promise<void>

export interface BundledSkillsInstallDeps extends BundledSkillsPaths {
  /** Windows takes a junction (no privilege needed), everything else a directory symlink. */
  readonly platform: NodeJS.Platform
  readonly now: () => number
  /** Names the work folders, so two windows never share one. */
  readonly newId: () => string
  readonly makeLink?: MakeLink | undefined
}

/** Why a step failed: a folder that is not the extension's, or the system's own error. */
export type BundledSkillsFailureReason =
  { readonly kind: 'notOurs' } | { readonly kind: 'error'; readonly message: string }

export interface BundledSkillsFailure {
  readonly folder: string
  readonly reason: BundledSkillsFailureReason
}

export interface BundledSkillsInstallResult {
  /** The vendored release installed; undefined when the vendored package could not be read. */
  readonly tag: string | undefined
  /** Skill ids linked to the copy, now or already. */
  readonly installed: readonly string[]
  /** Skill ids left alone: a folder or link of the user's has that name. */
  readonly skipped: readonly string[]
  /** An earlier release's links into the copy for ids this release no longer has. */
  readonly removed: readonly string[]
  readonly failure: BundledSkillsFailure | undefined
  /** After a failure, what this run made that could not be taken away again. */
  readonly undoFailure?: BundledSkillsFailure
}

export interface BundledSkillsRemoveResult {
  /** The links removed; the copy goes with them. */
  readonly removed: readonly string[]
  /** False when there was no marked copy, so nothing was touched. */
  readonly hadCopy: boolean
  readonly failure: BundledSkillsFailure | undefined
}

export type BundledSkillsStatus =
  | {
      readonly kind: 'notInstalled'
      readonly vendorTag: string
      readonly skillIds: readonly string[]
    }
  | {
      readonly kind: 'installed'
      readonly vendorTag: string
      readonly installedTag: string
      readonly skillIds: readonly string[]
    }
  /** A folder with the copy's name that carries no mark: never offered over. */
  | { readonly kind: 'notOurs'; readonly vendorTag: string; readonly skillIds: readonly string[] }

interface VendoredPackage {
  readonly tag: string
  readonly files: readonly string[]
  readonly skillIds: readonly string[]
  readonly firstPartyRoot: string
  readonly firstPartyIds: readonly string[]
}

type CopyState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ours'; readonly tag: string }
  | { readonly kind: 'notOurs' }

// VENDOR.json: the release's tag and path/hash records (`skills/<id>/SKILL.md`
// among them), relative, with forward slashes; hashes are checked by the vendor
// suite. The installer needs only the paths to discover the bundled skill ids.
const vendorSchema = z.object({
  tag: z.string().check(z.minLength(1)),
  files: z.array(z.object({ path: z.string() })),
})
const markerSchema = z.object({ tag: z.string().check(z.minLength(1)), installedAt: z.string() })
const VENDOR_PATH_SEPARATOR = '/'
const SKILL_FILE_PATH_PARTS = 3
const NOT_FOUND = 'ENOENT'
const WINDOWS_VERBATIM_PREFIX = '\\\\?\\'
const PARENT = '..'

/**
A system error with the named code: an absent entry is ENOENT, anything
else (a refusal, a vanished parent) is not. Reads only `.code`, never the
message, so the check itself leaks nothing.
*/
function isCode(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === NOT_FOUND
}

function describe(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

function failed(folder: string, error: unknown): BundledSkillsFailure {
  return { folder, reason: { kind: 'error', message: describe(error) } }
}

/** The copy's own folder: `<sources>/high-quality-projects-skill`. */
function copyFolder(paths: BundledSkillsPaths): string {
  return path.join(paths.sourcesRoot, BUNDLED_SKILLS_PACKAGE_NAME)
}

/**
The installed extension's own skill ids (M97): every folder under its
`skills/` holding a SKILL.md with a matching id. A missing root lists as
empty, like a missing catalog root; anything else throws.
*/
async function extraSkillIds(extensionSkillsRoot: string | undefined): Promise<readonly string[]> {
  if (extensionSkillsRoot === undefined) {
    return []
  }
  let names: readonly string[]
  try {
    names = await fs.readdir(extensionSkillsRoot)
  } catch (error: unknown) {
    if (isCode(error)) {
      return []
    }
    throw error
  }
  const ids: string[] = []
  for (const name of names) {
    if (!SKILL_ID_PATTERN.test(name)) {
      continue
    }
    let isFile = false
    try {
      const stat = await fs.stat(path.join(extensionSkillsRoot, name, SKILL_FILE_NAME))
      isFile = stat.isFile()
    } catch (error: unknown) {
      if (!isCode(error)) {
        throw error
      }
    }
    if (isFile) {
      ids.push(name)
    }
  }
  return ids.toSorted((left, right) => left.localeCompare(right, 'en'))
}

/** The tag and the skill ids the vendored package's VENDOR.json lists. */
async function readVendor(vendorRoot: string): Promise<VendoredPackage> {
  const file = path.join(vendorRoot, BUNDLED_SKILLS_VENDOR_FILE)
  const parsed = vendorSchema.safeParse(JSON.parse(await fs.readFile(file, 'utf8')))
  if (!parsed.success) {
    throw new Error(`${file} is not a vendor record: ${z.prettifyError(parsed.error)}`)
  }
  const listed = parsed.data.files.map(({ path: relative }) => relative.replaceAll('\\', '/'))
  const skillIds = listed.flatMap((relative) => {
    const parts = relative.split(VENDOR_PATH_SEPARATOR)
    const [dir, id, file] = parts
    return id !== undefined &&
      dir === BUNDLED_SKILLS_DIR &&
      file === SKILL_FILE_NAME &&
      parts.length === SKILL_FILE_PATH_PARTS &&
      SKILL_ID_PATTERN.test(id)
      ? id
      : []
  })
  if (skillIds.length === 0) {
    throw new Error(`${file} lists no skills`)
  }
  // Both installed sources belong to the same extension layout (D68/M92).
  // A missing first-party source is a broken package, not a partial success.
  const firstPartyRoot = path.resolve(vendorRoot, PARENT, PARENT, FIRST_PARTY_SKILLS_DIR)
  const hash = createHash('sha256')
  await hashTree(firstPartyRoot, '', hash)
  const firstPartyIds = await fs.readdir(firstPartyRoot)
  for (const id of firstPartyIds) {
    if (!SKILL_ID_PATTERN.test(id)) throw new Error(`${firstPartyRoot} has an invalid skill id`)
    const skillFile = path.join(firstPartyRoot, id, SKILL_FILE_NAME)
    const stats = await fs.lstat(skillFile)
    if (!stats.isFile()) throw new Error(`${skillFile} is not a skill file`)
  }
  return {
    // A first-party-only update must offer Update even when the vendor tag
    // stays the same. Full content digest includes supporting references.
    tag:
      firstPartyIds.length === 0
        ? parsed.data.tag
        : `${parsed.data.tag}+first-party.${hash.digest('hex')}`,
    files: listed,
    skillIds: [
      ...new Set([...skillIds, ...firstPartyIds.toSorted((a, b) => a.localeCompare(b, 'en'))]),
    ],
    firstPartyRoot,
    firstPartyIds,
  }
}

/** Deterministic, content-addressed release identity; links/devices never enter the copy. */
async function hashTree(folder: string, relative: string, hash: Hash): Promise<void> {
  const stats = await fs.lstat(folder)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${folder} is not a real folder`)
  }
  const entries = await fs.readdir(folder, { withFileTypes: true })
  const ordered = entries.toSorted((a, b) => a.name.localeCompare(b.name, 'en'))
  for (const entry of ordered) {
    const file = path.join(folder, entry.name)
    const identity = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) {
      await hashTree(file, identity, hash)
    } else if (entry.isFile()) {
      const digest = createHash('sha256')
        .update(await fs.readFile(file))
        .digest('hex')
      hash.update(JSON.stringify([identity, digest]))
    } else {
      throw new Error(`${file} is neither a file nor a folder`)
    }
  }
}

/** Whether the copy's folder is absent, the extension's (a real folder with a valid mark) or someone else's. */
async function copyState(folder: string): Promise<CopyState> {
  let stats
  try {
    stats = await fs.lstat(folder)
  } catch (error: unknown) {
    if (isCode(error)) {
      return { kind: 'absent' }
    }
    throw error
  }
  // A link is never the extension's copy, whatever it leads to.
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return { kind: 'notOurs' }
  }
  let text
  try {
    text = await fs.readFile(path.join(folder, BUNDLED_SKILLS_MARKER_FILE), 'utf8')
  } catch (error: unknown) {
    if (isCode(error)) {
      return { kind: 'notOurs' }
    }
    throw error
  }
  let marker: unknown
  try {
    marker = JSON.parse(text)
  } catch (error: unknown) {
    // A marker that is not JSON is not the extension's; anything else (only
    // a bug could throw it) reaches the caller with its cause.
    if (error instanceof SyntaxError) {
      return { kind: 'notOurs' }
    }
    throw error
  }
  const parsed = markerSchema.safeParse(marker)
  return parsed.success ? { kind: 'ours', tag: parsed.data.tag } : { kind: 'notOurs' }
}

/** Where a link leads, absolute; undefined when the entry is not a link. */
async function linkTarget(link: string): Promise<string | undefined> {
  const stats = await fs.lstat(link)
  if (!stats.isSymbolicLink()) {
    return undefined
  }
  let target = await fs.readlink(link)
  if (target.startsWith(WINDOWS_VERBATIM_PREFIX)) {
    target = target.slice(WINDOWS_VERBATIM_PREFIX.length)
  }
  return path.resolve(path.dirname(link), target)
}

function isSamePath(a: string, b: string): boolean {
  return path.relative(a, b) === ''
}

/** An extension-owned skill in any installed version directory, identified by product id. */
function isExtensionSkillTarget(target: string, id: string): boolean {
  if (path.basename(target) !== id || path.basename(path.dirname(target)) !== BUNDLED_SKILLS_DIR)
    return false
  const directory = path.basename(path.dirname(path.dirname(target))).toLowerCase()
  const prefix = `${EXTENSION_QUALIFIED_ID.toLowerCase()}-`
  return (
    directory.startsWith(prefix) &&
    /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(directory.slice(prefix.length))
  )
}

/** Whether `child` lies strictly inside `parent` (case-insensitively on Windows, as `path` compares). */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    relative !== '' &&
    relative !== PARENT &&
    !relative.startsWith(`${PARENT}${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/** A folder's files and folders, copied; anything else (a link, a device) refuses the copy. */
async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to)
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await copyTree(source, target)
    } else if (entry.isFile()) {
      await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL)
    } else {
      throw new Error(`${source} is neither a file nor a folder`)
    }
  }
}

/**
The solid archive beside the vendored package (VSIXWEB B): the packaged
install carries it instead of the loose members, with LICENSE and
VENDOR.json loose beside it.
*/
function vendorArchive(vendorRoot: string): string {
  return path.join(path.dirname(vendorRoot), BUNDLED_SKILLS_ARCHIVE_FILE)
}

/**
Stage the vendored tree: from the solid archive when the install runs
packaged — every member's bytes SHA-256 checked against the archive's
record and every VENDOR.json-listed path required staged, byte-identical
to the loose tree — or from the loose tree itself (the source tree, dev
builds). A missing, damaged or unreadable archive throws, and the caller
fails the install exactly as a damaged tree does today.
*/
async function stageVendorTree(
  vendorRoot: string,
  vendor: VendoredPackage,
  staging: string,
): Promise<void> {
  let packed: Buffer | undefined
  try {
    packed = await fs.readFile(vendorArchive(vendorRoot))
  } catch (error: unknown) {
    // No archive beside the package: the loose tree serves (an absent
    // member reads absent); anything else keeps its kind past the stage.
    if (!isCode(error)) throw error
  }
  if (packed === undefined) {
    await copyTree(vendorRoot, staging)
    return
  }
  const archived = parseSolidTextArchive(
    packed,
    BUNDLED_SKILLS_ARCHIVE_MAX_BYTES,
    BUNDLED_SKILLS_ARCHIVE_VERSION,
  )
  await fs.mkdir(staging, { recursive: true })
  for (const [relative, entry] of Object.entries(archived)) {
    const bytes = solidMemberBytes(entry, relative)
    if (bytes.byteLength > BUNDLED_SKILLS_ARCHIVE_MEMBER_MAX_BYTES)
      throw new Error(`Bundled skill member is over its bound: ${relative}`)
    const target = path.join(staging, ...relative.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, bytes, { flag: 'wx' })
  }
  // The loose evidence and attribution a person reads travel beside the
  // archive; anything the archive holds stays out of the package loose.
  for (const name of [BUNDLED_SKILLS_LICENSE_FILE, BUNDLED_SKILLS_VENDOR_FILE]) {
    if (Object.hasOwn(archived, name)) continue
    await fs.copyFile(
      path.join(vendorRoot, name),
      path.join(staging, name),
      fsConstants.COPYFILE_EXCL,
    )
  }
  // A listed path the archive and the loose evidence both lack is a
  // truncated package, refused like a damaged tree.
  for (const relative of vendor.files) {
    const isStaged = await isStagedFile(staging, relative)
    if (!isStaged) throw new Error(`Bundled skill member is not staged: ${relative}`)
  }
}

/** Whether `staging` holds `relative` as a real file; anything else reads absent. */
async function isStagedFile(staging: string, relative: string): Promise<boolean> {
  try {
    const held = await fs.lstat(path.join(staging, ...relative.split('/')))
    return held.isFile()
  } catch (error: unknown) {
    if (!isCode(error)) throw error
    return false
  }
}

/** The links in Muse Code's skills folder that lead into the copy's `skills/`, by name. */
async function linksInto(
  skillsRoot: string,
  copySkills: string,
  isExtension = false,
): Promise<readonly string[]> {
  let names: readonly string[]
  try {
    names = await fs.readdir(skillsRoot)
  } catch (error: unknown) {
    if (isCode(error)) {
      return []
    }
    throw error
  }
  const ours: string[] = []
  for (const name of names) {
    const target = await linkTarget(path.join(skillsRoot, name))
    if (
      target !== undefined &&
      (isInside(copySkills, target) || (isExtension && isExtensionSkillTarget(target, name)))
    ) {
      ours.push(name)
    }
  }
  return ours
}

/**
The new copy renamed in: over nothing, or over the extension's earlier
copy, which steps aside first and comes back if the rename fails.
*/
async function renameIn(
  staging: string,
  folder: string,
  hasEarlier: boolean,
  newId: () => string,
): Promise<string | undefined> {
  if (!hasEarlier) {
    await fs.rename(staging, folder)
    return undefined
  }
  const retired = path.join(
    path.dirname(folder),
    `.${BUNDLED_SKILLS_PACKAGE_NAME}.${BUNDLED_SKILLS_RETIRED_WORD}-${newId()}`,
  )
  await fs.rename(folder, retired)
  try {
    await fs.rename(staging, folder)
  } catch (error: unknown) {
    await fs.rename(retired, folder)
    throw error
  }
  return retired
}

/** What `vendorRoot`'s VENDOR.json says against the copy in the config home. */
export async function bundledSkillsStatus(paths: BundledSkillsPaths): Promise<BundledSkillsStatus> {
  const vendor = await readVendor(paths.vendorRoot)
  const state = await copyState(copyFolder(paths))
  const skillIds = [...vendor.skillIds, ...(await extraSkillIds(paths.extensionSkillsRoot))]
  const common = { vendorTag: vendor.tag, skillIds }
  switch (state.kind) {
    case 'absent': {
      return { kind: 'notInstalled', ...common }
    }
    case 'ours': {
      return { kind: 'installed', installedTag: state.tag, ...common }
    }
    case 'notOurs': {
      return { kind: 'notOurs', ...common }
    }
  }
}

/** Install, or update the extension's own copy (the same steps). */
export async function installBundledSkills(
  deps: BundledSkillsInstallDeps,
): Promise<BundledSkillsInstallResult> {
  const nothing = { installed: [], skipped: [], removed: [] }
  let vendor: VendoredPackage
  try {
    vendor = await readVendor(deps.vendorRoot)
  } catch (error: unknown) {
    return { tag: undefined, ...nothing, failure: failed(deps.vendorRoot, error) }
  }
  const folder = copyFolder(deps)
  const copySkills = path.join(folder, BUNDLED_SKILLS_DIR)
  const copyFirstParty = path.join(folder, FIRST_PARTY_SKILLS_DIR)
  const makeLink: MakeLink =
    deps.makeLink ?? ((target, link, type) => fs.symlink(target, link, type))
  const linkType = deps.platform === 'win32' ? 'junction' : 'dir'
  const installed: string[] = []
  const skipped: string[] = []
  const removed: string[] = []
  // What this run made, undone in reverse if a later step fails.
  const made: { readonly path: string; readonly restore: () => Promise<void> }[] = []
  let at = folder
  try {
    const state = await copyState(folder)
    if (state.kind === 'notOurs') {
      return { tag: vendor.tag, ...nothing, failure: { folder, reason: { kind: 'notOurs' } } }
    }
    at = deps.sourcesRoot
    await fs.mkdir(deps.sourcesRoot, { recursive: true })
    const staging = path.join(
      deps.sourcesRoot,
      `.${BUNDLED_SKILLS_PACKAGE_NAME}.${BUNDLED_SKILLS_STAGING_WORD}-${deps.newId()}`,
    )
    at = staging
    let retired: string | undefined
    try {
      await stageVendorTree(deps.vendorRoot, vendor, staging)
      for (const id of vendor.firstPartyIds) {
        const target = path.join(staging, BUNDLED_SKILLS_DIR, id)
        // First-party precedence matches the Model API's bundled roots.
        await fs.rm(target, { recursive: true, force: true })
        await copyTree(path.join(vendor.firstPartyRoot, id), target)
      }
      at = folder
      retired = await renameIn(staging, folder, state.kind === 'ours', deps.newId)
    } catch (error: unknown) {
      await fs.rm(staging, { recursive: true, force: true })
      throw error
    }
    made.push({
      path: folder,
      restore: async () => {
        await fs.rm(folder, { recursive: true, force: true })
        if (retired !== undefined) await fs.rename(retired, folder)
      },
    })
    at = deps.skillsRoot
    await fs.mkdir(deps.skillsRoot, { recursive: true })
    // The vendored skills link at the copy; the extension's own link
    // straight at the extension, with no copy and no tag (M97).
    const extensionRoot = deps.extensionSkillsRoot
    const extra = await extraSkillIds(extensionRoot)
    const links = [
      ...vendor.skillIds.map((id) => ({ id, target: path.join(copySkills, id) })),
      ...(extensionRoot === undefined
        ? []
        : extra.map((id) => ({ id, target: path.join(extensionRoot, id) }))),
    ]
    for (const { id, target } of links) {
      const link = path.join(deps.skillsRoot, id)
      at = link
      let existing: string | undefined
      try {
        existing = await linkTarget(link)
      } catch (error: unknown) {
        if (!isCode(error)) {
          throw error
        }
        await makeLink(target, link, linkType)
        made.push({ path: link, restore: () => fs.unlink(link) })
        installed.push(id)
        continue
      }
      // Ours only when it leads to this very skill of the copy.
      if (existing !== undefined && isSamePath(existing, target)) {
        installed.push(id)
      } else if (
        existing !== undefined &&
        ((state.kind === 'ours' &&
          [copySkills, copyFirstParty].some((root) => isSamePath(existing, path.join(root, id)))) ||
          (extensionRoot !== undefined &&
            isInside(extensionRoot, target) &&
            isExtensionSkillTarget(existing, id)))
      ) {
        await fs.unlink(link)
        made.push({ path: link, restore: () => fs.symlink(existing, link, linkType) })
        await makeLink(target, link, linkType)
        made.push({ path: link, restore: () => fs.unlink(link) })
        installed.push(id)
      } else {
        skipped.push(id)
      }
    }
    // An earlier release's skill this one dropped: its link would lead nowhere.
    at = deps.skillsRoot
    const ourLinks = [
      ...(await linksInto(deps.skillsRoot, copySkills)),
      ...(await linksInto(deps.skillsRoot, copyFirstParty)),
    ]
    if (extensionRoot !== undefined) {
      ourLinks.push(...(await linksInto(deps.skillsRoot, extensionRoot, true)))
    }
    for (const name of ourLinks) {
      if (vendor.skillIds.includes(name) || extra.includes(name)) {
        continue
      }
      at = path.join(deps.skillsRoot, name)
      const link = at
      const target = await fs.readlink(link)
      await fs.unlink(at)
      made.push({ path: link, restore: () => fs.symlink(target, link, linkType) })
      removed.push(name)
    }
    // The tag commits only after every non-colliding link is reachable.
    at = path.join(folder, BUNDLED_SKILLS_MARKER_FILE)
    const marker = { tag: vendor.tag, installedAt: new Date(deps.now()).toISOString() }
    await fs.writeFile(at, JSON.stringify(marker) + '\n', { flag: 'wx' })
    if (retired !== undefined) {
      at = retired
      await fs.rm(retired, { recursive: true, force: true })
    }
    return { tag: vendor.tag, installed, skipped, removed, failure: undefined }
  } catch (error: unknown) {
    const failure = failed(at, error)
    const undoFailure = await undo(made)
    return {
      tag: vendor.tag,
      ...nothing,
      failure,
      ...(undoFailure !== undefined && { undoFailure }),
    }
  }
}

/** Takes away what a failed install made, newest first; the first step that fails is reported. */
async function undo(
  made: readonly { readonly path: string; readonly restore: () => Promise<void> }[],
): Promise<BundledSkillsFailure | undefined> {
  const newestFirst = made.toReversed()
  for (const item of newestFirst) {
    try {
      await item.restore()
    } catch (error: unknown) {
      return failed(item.path, error)
    }
  }
  return undefined
}

/** Remove the links into the marked copy, then the copy; nothing without the mark. */
export async function removeBundledSkills(
  paths: BundledSkillsPaths,
): Promise<BundledSkillsRemoveResult> {
  const folder = copyFolder(paths)
  const removed: string[] = []
  let at = folder
  try {
    const state = await copyState(folder)
    // No copy of ours: only the extension's own links can be ours (M97).
    if (state.kind !== 'ours') {
      if (paths.extensionSkillsRoot !== undefined) {
        at = paths.skillsRoot
        const extraLinks = await linksInto(paths.skillsRoot, paths.extensionSkillsRoot, true)
        for (const name of extraLinks) {
          at = path.join(paths.skillsRoot, name)
          await fs.unlink(at)
          removed.push(name)
        }
      }
      return { removed, hadCopy: false, failure: undefined }
    }
    at = paths.skillsRoot
    const ourLinks = [
      ...(await linksInto(paths.skillsRoot, path.join(folder, BUNDLED_SKILLS_DIR))),
      ...(await linksInto(paths.skillsRoot, path.join(folder, FIRST_PARTY_SKILLS_DIR))),
    ]
    if (paths.extensionSkillsRoot !== undefined) {
      ourLinks.push(...(await linksInto(paths.skillsRoot, paths.extensionSkillsRoot, true)))
    }
    for (const name of ourLinks) {
      at = path.join(paths.skillsRoot, name)
      await fs.unlink(at)
      removed.push(name)
    }
    at = folder
    // A real folder (copyState checked), holding only files and folders.
    await fs.rm(folder, { recursive: true })
    return { removed, hadCopy: true, failure: undefined }
  } catch (error: unknown) {
    return { removed, hadCopy: true, failure: failed(at, error) }
  }
}
