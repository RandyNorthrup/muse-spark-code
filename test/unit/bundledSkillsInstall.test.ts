// The bundled skills for Muse Code (M89, PLAN.md D68): the installer over
// real folders in a temporary config home (the copy, its mark, the links;
// the user's own skills left alone; links out of the copy never followed or
// deleted; removal only of what carries the mark; a failed install taken
// back), the link kind per platform, the shipped bundle built as
// scripts/build.mjs builds it, the panel's one-time offer, and what the two
// commands say.

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  bundledSkillsLoader,
  type BundledSkillsBundle,
  type BundledSkillsCommandDeps,
  createBundledSkillsOffer,
  isBundledSkillsBundle,
  runBundledSkillsInstall,
  runBundledSkillsRemove,
} from '../../src/host/skills/bundledSkills'
import {
  bundledSkillsStatus,
  type BundledSkillsInstallDeps,
  type BundledSkillsPaths,
  type BundledSkillsStatus,
  installBundledSkills,
  type MakeLink,
  removeBundledSkills,
} from '../../src/host/skills/bundledSkillsInstall'
import { BUNDLED_SKILLS_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { buildHostBundles } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

const IDS = ['project_setup', 'feature_delivery', 'quality_retrofit'] as const
const MARKER = '.muse-spark-bundled.json'
const PACKAGE = 'high-quality-projects-skill'
const NOW = Date.UTC(2026, 9, 3, 12)

const folders: string[] = []

function tempFolder(prefix: string): string {
  const folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)))
  folders.push(folder)
  return folder
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})

function writeFile(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

/** A vendored package as the sync script leaves it: the skills, a script, a doc, VENDOR.json. */
function vendor(root: string, tag: string, ids: readonly string[] = IDS): string {
  const vendorRoot = path.join(root, 'vendor', PACKAGE)
  const files = [
    ...ids.map((id) => `skills/${id}/SKILL.md`),
    'skills/project_setup/references/grill-me.md',
    'scripts/skill-root.sh',
    'docs/DELIVERY.md',
  ]
  for (const file of files) {
    writeFile(path.join(vendorRoot, ...file.split('/')), `${file} at ${tag}\n`)
  }
  writeFile(
    path.join(vendorRoot, 'VENDOR.json'),
    JSON.stringify({
      source: 'https://example.test/pkg',
      tag,
      archiveSha256: 'ab'.repeat(32),
      files: files.map((file) => ({
        path: file,
        sha256: createHash('sha256')
          .update(readFileSync(path.join(vendorRoot, file)))
          .digest('hex'),
      })),
    }),
  )
  return vendorRoot
}

interface Fixture extends BundledSkillsPaths {
  readonly root: string
  readonly copy: string
}

function fixture(
  tag = 'v0.7.0',
  ids: readonly string[] = IDS,
  extensionSkills: readonly string[] = [],
): Fixture {
  const root = tempFolder('muse-bundled-')
  const config = path.join(root, 'config')
  for (const id of extensionSkills) {
    writeFile(
      path.join(root, 'skills', id, 'SKILL.md'),
      `---\nname: ${id}\ndescription: ${id}\n---\n`,
    )
  }
  return {
    root,
    vendorRoot: vendor(root, tag, ids),
    skillsRoot: path.join(config, 'muse', 'skills'),
    sourcesRoot: path.join(config, 'muse', 'skill-sources'),
    copy: path.join(config, 'muse', 'skill-sources', PACKAGE),
    ...(extensionSkills.length > 0 && { extensionSkillsRoot: path.join(root, 'skills') }),
  }
}

function deps(paths: BundledSkillsPaths, extra: Partial<BundledSkillsInstallDeps> = {}) {
  const ids = { next: 0 }
  return {
    ...paths,
    platform: process.platform,
    now: () => NOW,
    newId: () => {
      ids.next += 1
      return `id${String(ids.next)}`
    },
    ...extra,
  }
}

/** Names in their order in English, as a listing is compared. */
function sorted(names: readonly string[]): readonly string[] {
  return names.toSorted((a, b) => a.localeCompare(b, 'en'))
}

/** Where a link in the skills folder leads, resolved. */
function leadsTo(link: string): string {
  return path.resolve(path.dirname(link), readlinkSync(link))
}

/** A directory link of the running platform's kind. */
function linkFolder(target: string, link: string): void {
  mkdirSync(path.dirname(link), { recursive: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('installBundledSkills', () => {
  it('copies the package, marks it, and links each skill into Muse Code’s skills folder', async () => {
    const f = fixture()
    const result = await installBundledSkills(deps(f))
    expect(result).toEqual({
      tag: 'v0.7.0',
      installed: [...IDS],
      skipped: [],
      removed: [],
      failure: undefined,
    })
    expect(readFileSync(path.join(f.copy, 'scripts', 'skill-root.sh'), 'utf8')).toBe(
      'scripts/skill-root.sh at v0.7.0\n',
    )
    expect(
      readFileSync(
        path.join(f.copy, 'skills', 'project_setup', 'references', 'grill-me.md'),
        'utf8',
      ),
    ).toContain('grill-me')
    expect(JSON.parse(readFileSync(path.join(f.copy, MARKER), 'utf8'))).toEqual({
      tag: 'v0.7.0',
      installedAt: '2026-10-03T12:00:00.000Z',
    })
    for (const id of IDS) {
      const link = path.join(f.skillsRoot, id)
      expect(lstatSync(link).isSymbolicLink()).toBe(true)
      expect(leadsTo(link)).toBe(path.join(f.copy, 'skills', id))
      expect(readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toBe(
        `skills/${id}/SKILL.md at v0.7.0\n`,
      )
    }
    // No work folder is left beside the copy.
    expect(readdirSync(f.sourcesRoot)).toEqual([PACKAGE])
    await expect(bundledSkillsStatus(f)).resolves.toEqual({
      kind: 'installed',
      vendorTag: 'v0.7.0',
      installedTag: 'v0.7.0',
      skillIds: [...IDS],
    })
  })

  it.each([
    ['win32', 'junction'],
    ['linux', 'dir'],
    ['darwin', 'dir'],
  ] as const)('makes a %s link as a %s', async (platform, kind) => {
    const f = fixture()
    const calls: string[] = []
    // The kind asked for is recorded; the link made is one this machine can
    // make without privilege (a Windows symlink needs one), so all three go.
    const makeLink: MakeLink = async (target, link, type) => {
      calls.push(type)
      await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : type)
    }
    const result = await installBundledSkills(deps(f, { platform, makeLink }))
    expect(calls).toEqual([kind, kind, kind])
    expect(result.failure).toBeUndefined()
  })

  it('leaves a skill of the user’s with a bundled id alone, and names it', async () => {
    const f = fixture()
    writeFile(path.join(f.skillsRoot, 'project_setup', 'SKILL.md'), 'mine\n')
    // A link of the user's that leads outside the copy is theirs too.
    const elsewhere = path.join(f.root, 'dotfiles', 'feature_delivery')
    writeFile(path.join(elsewhere, 'SKILL.md'), 'dotfiles\n')
    linkFolder(elsewhere, path.join(f.skillsRoot, 'feature_delivery'))
    const result = await installBundledSkills(deps(f))
    expect(result.installed).toEqual(['quality_retrofit'])
    expect(result.skipped).toEqual(['project_setup', 'feature_delivery'])
    expect(result.failure).toBeUndefined()
    expect(readFileSync(path.join(f.skillsRoot, 'project_setup', 'SKILL.md'), 'utf8')).toBe(
      'mine\n',
    )
    expect(lstatSync(path.join(f.skillsRoot, 'project_setup')).isSymbolicLink()).toBe(false)
    expect(leadsTo(path.join(f.skillsRoot, 'feature_delivery'))).toBe(elsewhere)
    expect(readFileSync(path.join(elsewhere, 'SKILL.md'), 'utf8')).toBe('dotfiles\n')
  })

  it('installs again over its own copy, keeping its links', async () => {
    const f = fixture()
    await installBundledSkills(deps(f))
    const again = await installBundledSkills(deps(f, { now: () => NOW + 1000 }))
    expect(again).toMatchObject({ installed: [...IDS], skipped: [], failure: undefined })
    expect(JSON.parse(readFileSync(path.join(f.copy, MARKER), 'utf8'))).toMatchObject({
      installedAt: '2026-10-03T12:00:01.000Z',
    })
    expect(readdirSync(f.sourcesRoot)).toEqual([PACKAGE])
  })

  it('updates its copy to a newer release and takes away the link of a skill the release dropped', async () => {
    const f = fixture('v0.7.0')
    await installBundledSkills(deps(f))
    const newer = vendor(path.join(f.root, 'newer'), 'v0.8.0', [
      'project_setup',
      'feature_delivery',
    ])
    await expect(bundledSkillsStatus({ ...f, vendorRoot: newer })).resolves.toMatchObject({
      kind: 'installed',
      vendorTag: 'v0.8.0',
      installedTag: 'v0.7.0',
    })
    const result = await installBundledSkills(deps({ ...f, vendorRoot: newer }))
    expect(result).toEqual({
      tag: 'v0.8.0',
      installed: ['project_setup', 'feature_delivery'],
      skipped: [],
      removed: ['quality_retrofit'],
      failure: undefined,
    })
    expect(existsSync(path.join(f.skillsRoot, 'quality_retrofit'))).toBe(false)
    expect(readFileSync(path.join(f.skillsRoot, 'project_setup', 'SKILL.md'), 'utf8')).toBe(
      'skills/project_setup/SKILL.md at v0.8.0\n',
    )
    expect(JSON.parse(readFileSync(path.join(f.copy, MARKER), 'utf8'))).toMatchObject({
      tag: 'v0.8.0',
    })
    expect(readdirSync(f.sourcesRoot)).toEqual([PACKAGE])
  })

  it('refuses a copy folder it did not mark, and writes nothing', async () => {
    const f = fixture()
    writeFile(path.join(f.copy, 'README.md'), 'a clone of the user’s\n')
    const result = await installBundledSkills(deps(f))
    expect(result).toEqual({
      tag: 'v0.7.0',
      installed: [],
      skipped: [],
      removed: [],
      failure: { folder: f.copy, reason: { kind: 'notOurs' } },
    })
    expect(readdirSync(f.copy)).toEqual(['README.md'])
    expect(existsSync(f.skillsRoot)).toBe(false)
    await expect(bundledSkillsStatus(f)).resolves.toMatchObject({ kind: 'notOurs' })
  })

  it('takes a link in the copy’s place for someone else’s, even one leading to a marked folder', async () => {
    const f = fixture()
    const marked = path.join(f.root, 'marked')
    writeFile(path.join(marked, MARKER), JSON.stringify({ tag: 'v0.7.0', installedAt: 'x' }))
    linkFolder(marked, f.copy)
    const result = await installBundledSkills(deps(f))
    expect(result.failure).toEqual({ folder: f.copy, reason: { kind: 'notOurs' } })
    expect(readdirSync(marked)).toEqual([MARKER])
    await expect(removeBundledSkills(f)).resolves.toEqual({
      removed: [],
      hadCopy: false,
      failure: undefined,
    })
    expect(existsSync(path.join(marked, MARKER))).toBe(true)
  })

  it('takes back what it made when a step fails', async () => {
    const f = fixture()
    let links = 0
    const makeLink: MakeLink = async (target, link, type) => {
      links += 1
      if (links === 2) {
        throw new Error('EPERM: operation not permitted')
      }
      await fs.symlink(target, link, type)
    }
    const result = await installBundledSkills(deps(f, { makeLink }))
    expect(result).toEqual({
      tag: 'v0.7.0',
      installed: [],
      skipped: [],
      removed: [],
      failure: {
        folder: path.join(f.skillsRoot, 'feature_delivery'),
        reason: { kind: 'error', message: 'EPERM: operation not permitted' },
      },
    })
    expect(readdirSync(f.skillsRoot)).toEqual([])
    expect(readdirSync(f.sourcesRoot)).toEqual([])
  })

  it('says why when the vendored package cannot be read, and writes nothing', async () => {
    const f = fixture()
    writeFileSync(path.join(f.vendorRoot, 'VENDOR.json'), '{"tag": ""}')
    const result = await installBundledSkills(deps(f))
    expect(result.tag).toBeUndefined()
    expect(result.failure?.folder).toBe(f.vendorRoot)
    expect(result.failure?.reason).toMatchObject({ kind: 'error' })
    expect(existsSync(f.sourcesRoot)).toBe(false)
    await expect(bundledSkillsStatus(f)).rejects.toThrow('is not a vendor record')
    writeFileSync(
      path.join(f.vendorRoot, 'VENDOR.json'),
      JSON.stringify({ tag: 'v1', files: [{ path: 'README.md', sha256: 'ab'.repeat(32) }] }),
    )
    await expect(bundledSkillsStatus(f)).rejects.toThrow('lists no skills')
  })

  it('refuses to copy a vendored package that holds a link, and leaves no work folder', async () => {
    const f = fixture()
    mkdirSync(path.join(f.root, 'outside'), { recursive: true })
    linkFolder(path.join(f.root, 'outside'), path.join(f.vendorRoot, 'docs', 'escape'))
    const result = await installBundledSkills(deps(f))
    expect(result.failure?.reason).toEqual({
      kind: 'error',
      message: `${path.join(f.vendorRoot, 'docs', 'escape')} is neither a file nor a folder`,
    })
    expect(readdirSync(f.sourcesRoot)).toEqual([])
  })
})

describe('removeBundledSkills', () => {
  it('removes its links and its copy, and nothing of the user’s', async () => {
    const f = fixture()
    await installBundledSkills(deps(f))
    writeFile(path.join(f.skillsRoot, 'mine', 'SKILL.md'), 'mine\n')
    const outside = path.join(f.root, 'dotfiles', 'dot')
    writeFile(path.join(outside, 'SKILL.md'), 'dot\n')
    linkFolder(outside, path.join(f.skillsRoot, 'dot'))
    // A folder whose name starts like the copy's is not inside it.
    const lookalike = path.join(`${f.copy}-other`, 'skills', 'x')
    writeFile(path.join(lookalike, 'SKILL.md'), 'x\n')
    linkFolder(lookalike, path.join(f.skillsRoot, 'x'))
    const result = await removeBundledSkills(f)
    expect(result.failure).toBeUndefined()
    expect(result.hadCopy).toBe(true)
    expect(sorted(result.removed)).toEqual(sorted(IDS))
    expect(sorted(readdirSync(f.skillsRoot))).toEqual(['dot', 'mine', 'x'])
    expect(leadsTo(path.join(f.skillsRoot, 'dot'))).toBe(outside)
    expect(readFileSync(path.join(outside, 'SKILL.md'), 'utf8')).toBe('dot\n')
    expect(readFileSync(path.join(lookalike, 'SKILL.md'), 'utf8')).toBe('x\n')
    expect(existsSync(f.copy)).toBe(false)
    await expect(removeBundledSkills(f)).resolves.toEqual({
      removed: [],
      hadCopy: false,
      failure: undefined,
    })
  })

  it('touches nothing when the copy carries no mark, even links that lead into it', async () => {
    const f = fixture()
    await installBundledSkills(deps(f))
    await fs.rm(path.join(f.copy, MARKER))
    await expect(removeBundledSkills(f)).resolves.toEqual({
      removed: [],
      hadCopy: false,
      failure: undefined,
    })
    expect(sorted(readdirSync(f.skillsRoot))).toEqual(sorted(IDS))
    expect(existsSync(path.join(f.copy, 'skills', 'project_setup', 'SKILL.md'))).toBe(true)
  })

  it('touches nothing when the mark is not the install’s', async () => {
    const f = fixture()
    await installBundledSkills(deps(f))
    writeFileSync(path.join(f.copy, MARKER), '{"tag": 7}')
    await expect(removeBundledSkills(f)).resolves.toMatchObject({ hadCopy: false, removed: [] })
    expect(existsSync(f.copy)).toBe(true)
  })
})

describe('on this platform, end to end', () => {
  it('installs into a config home, lists the links, and removes them again', async () => {
    const f = fixture()
    const installed = await installBundledSkills(deps(f))
    expect(installed.failure).toBeUndefined()
    const listing = sorted(readdirSync(f.skillsRoot)).map((name) => {
      const link = path.join(f.skillsRoot, name)
      const kind = lstatSync(link).isSymbolicLink() ? 'link' : 'folder'
      return `${name} (${kind}) -> ${path.relative(f.root, leadsTo(link))}`
    })
    // The rigs' record (docs/certification/m89.md): what this platform made.
    process.stdout.write(`bundled skills on ${process.platform}:\n  ${listing.join('\n  ')}\n`)
    expect(listing).toEqual(
      sorted(IDS).map(
        (id) =>
          `${id} (link) -> ${path.join('config', 'muse', 'skill-sources', PACKAGE, 'skills', id)}`,
      ),
    )
    const removed = await removeBundledSkills(f)
    expect(removed.failure).toBeUndefined()
    expect(readdirSync(f.skillsRoot)).toEqual([])
    expect(readdirSync(f.sourcesRoot)).toEqual([])
  })
})

describe('the shipped bundle', () => {
  const built = { folder: '', file: '' }

  // Built as scripts/build.mjs builds it.
  beforeAll(async () => {
    built.folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-bundled-bundle-')))
    built.file = path.join(built.folder, BUNDLED_SKILLS_BUNDLE_FILE)
    await buildHostBundles(built.folder, {
      [path.parse(BUNDLED_SKILLS_BUNDLE_FILE).name]: path.resolve(
        'src/host/skills/bundledSkillsEntry.ts',
      ),
    })
  })
  afterAll(() => removeFolder(built.folder))

  it('is required by the loader and installs through it', async () => {
    const load = bundledSkillsLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
    const bundle = load()
    expect(load()).toBe(bundle)
    const f = fixture()
    await expect(bundle.bundledSkillsStatus(f)).resolves.toMatchObject({ kind: 'notInstalled' })
    await expect(bundle.installBundledSkills(deps(f))).resolves.toMatchObject({
      installed: [...IDS],
      failure: undefined,
    })
    await expect(bundle.removeBundledSkills(f)).resolves.toMatchObject({ hadCopy: true })
  })

  it('refuses a missing or malformed module with the reason, and tries again later', () => {
    const log = new FakeLogOutputChannel()
    let module: unknown = { installBundledSkills: () => undefined }
    const load = bundledSkillsLoader({
      bundlePath: '/dist/bundledSkills.js',
      log,
      loadBundle: () => module,
    })
    expect(() => load()).toThrow(UI_TEXT.bundledSkillsUnavailable)
    expect(log.error).toHaveBeenCalledWith(
      '/dist/bundledSkills.js does not export the bundled skills installer',
    )
    module = {
      bundledSkillsStatus: () => undefined,
      installBundledSkills: () => undefined,
      removeBundledSkills: () => undefined,
    }
    expect(isBundledSkillsBundle(load())).toBe(true)
    expect(isBundledSkillsBundle(null)).toBe(false)
    expect(isBundledSkillsBundle({ bundledSkillsStatus: 1 })).toBe(false)
  })
})

/** `globalState` as the offer uses it: a map the test reads back. */
function memento(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: (key: string) => values.get(key),
    update: (key: string, value: unknown) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

describe('createBundledSkillsOffer', () => {
  const KEYS = { installDeclined: 'install', updateDeclined: 'update' }

  const notInstalled: BundledSkillsStatus = {
    kind: 'notInstalled',
    vendorTag: 'v0.7.0',
    skillIds: [...IDS],
  }
  const installed = (installedTag: string, vendorTag: string): BundledSkillsStatus => ({
    kind: 'installed',
    installedTag,
    vendorTag,
    skillIds: [...IDS],
  })

  function offer(status: () => Promise<BundledSkillsStatus>, state = memento(), isOn = true) {
    return {
      state,
      offer: createBundledSkillsOffer({ isEnabled: () => isOn, state, keys: KEYS, status }),
    }
  }

  it('offers the install once per window, with Install and Not now', async () => {
    const t = offer(() => Promise.resolve(notInstalled))
    await expect(t.offer.next()).resolves.toEqual({
      text: 'Muse Spark comes with the skills project_setup, feature_delivery, quality_retrofit. Install them for Muse Code? They are copied into your Muse config folder.',
      actions: ['installBundledSkills', 'declineBundledSkills'],
    })
    await expect(t.offer.next()).resolves.toBeUndefined()
  })

  it('offers once when two conversations start together', async () => {
    const t = offer(() => Promise.resolve(notInstalled))
    const notices = await Promise.all([t.offer.next(), t.offer.next(), t.offer.next()])
    expect(notices.filter((notice) => notice !== undefined)).toHaveLength(1)
  })

  it('offers nothing, and reads nothing, while the setting is off', async () => {
    const status = vi.fn(() => Promise.resolve(notInstalled))
    const t = offer(status, memento(), false)
    await expect(t.offer.next()).resolves.toBeUndefined()
    expect(status).not.toHaveBeenCalled()
  })

  it('remembers Not now on the install for every later window', async () => {
    const t = offer(() => Promise.resolve(notInstalled))
    await t.offer.next()
    await t.offer.decline()
    expect(t.state.values.get('install')).toBe(true)
    const later = offer(() => Promise.resolve(notInstalled), t.state)
    await expect(later.offer.next()).resolves.toBeUndefined()
  })

  it('offers nothing over a current copy or someone else’s folder, and asks again later', async () => {
    const status = vi.fn(() => Promise.resolve(installed('v0.7.0', 'v0.7.0')))
    const t = offer(status)
    await expect(t.offer.next()).resolves.toBeUndefined()
    status.mockResolvedValue({ kind: 'notOurs', vendorTag: 'v0.7.0', skillIds: [...IDS] })
    await expect(t.offer.next()).resolves.toBeUndefined()
    status.mockResolvedValue(notInstalled)
    await expect(t.offer.next()).resolves.toMatchObject({
      actions: ['installBundledSkills', 'declineBundledSkills'],
    })
    expect(status).toHaveBeenCalledTimes(3)
  })

  it('offers Update once for an older copy, and Not now holds until a newer release ships', async () => {
    const t = offer(() => Promise.resolve(installed('v0.6.0', 'v0.7.0')))
    await expect(t.offer.next()).resolves.toEqual({
      text: 'Muse Spark comes with a newer release of its bundled skills (v0.7.0). Update the copy Muse Code uses?',
      actions: ['updateBundledSkills', 'declineBundledSkills'],
    })
    await t.offer.decline()
    expect(t.state.values.get('update')).toBe('v0.7.0')
    expect(t.state.values.has('install')).toBe(false)
    const sameRelease = offer(() => Promise.resolve(installed('v0.6.0', 'v0.7.0')), t.state)
    await expect(sameRelease.offer.next()).resolves.toBeUndefined()
    const newerRelease = offer(() => Promise.resolve(installed('v0.6.0', 'v0.8.0')), t.state)
    await expect(newerRelease.offer.next()).resolves.toMatchObject({
      actions: ['updateBundledSkills', 'declineBundledSkills'],
    })
  })

  it('lets a later conversation try again after the status could not be read', async () => {
    const status = vi.fn().mockRejectedValueOnce(new Error('VENDOR.json is missing'))
    status.mockResolvedValue(notInstalled)
    const t = offer(status)
    await expect(t.offer.next()).rejects.toThrow('VENDOR.json is missing')
    await expect(t.offer.next()).resolves.toMatchObject({
      actions: ['installBundledSkills', 'declineBundledSkills'],
    })
  })

  it('remembers nothing when Not now comes before any offer', async () => {
    const t = offer(() => Promise.resolve(notInstalled))
    await t.offer.decline()
    expect(t.state.values.size).toBe(0)
  })
})

/** The commands over a fake installer: what they said, and the restart offer. */
function commandDeps(
  bundle: Partial<BundledSkillsBundle>,
  isRunning = true,
  isRestartConfirmed = true,
) {
  const said: string[] = []
  const errors: string[] = []
  const restart = vi.fn(() => Promise.resolve())
  const confirmRestart = vi.fn(() => Promise.resolve(isRestartConfirmed))
  const run: BundledSkillsCommandDeps = {
    bundle: () => ({
      bundledSkillsStatus: () => Promise.reject(new Error('unused')),
      installBundledSkills: () => Promise.reject(new Error('unused')),
      removeBundledSkills: () => Promise.reject(new Error('unused')),
      ...bundle,
    }),
    paths: () => ({
      vendorRoot: '/ext/v',
      skillsRoot: '/c/muse/skills',
      sourcesRoot: '/c/muse/s',
    }),
    platform: 'linux',
    now: () => NOW,
    newId: () => 'id',
    showInformation: (message) => {
      said.push(message)
    },
    showError: (message) => {
      errors.push(message)
    },
    isMuseCodeRunning: () => isRunning,
    confirmRestart,
    restart,
    log: new FakeLogOutputChannel(),
  }
  return { run, said, errors, restart, confirmRestart }
}

describe('the two commands', () => {
  it('says what was installed and left out, then offers the restart', async () => {
    const t = commandDeps({
      installBundledSkills: () =>
        Promise.resolve({
          tag: 'v0.7.0',
          installed: ['feature_delivery', 'quality_retrofit'],
          skipped: ['project_setup'],
          removed: [],
          failure: undefined,
        }),
    })
    await runBundledSkillsInstall(t.run)
    expect(t.said).toEqual([
      'Installed 2 bundled skills (v0.7.0) for Muse Code: feature_delivery, quality_retrofit. Left 1 skill out because a skill of yours has that name: project_setup',
      UI_TEXT.restartedNotice,
    ])
    expect(t.errors).toEqual([])
    expect(t.restart).toHaveBeenCalledTimes(1)
  })

  it('offers no restart while Muse Code is not running, or when the user says Later', async () => {
    const result = { tag: 'v0.7.0', installed: ['x'], skipped: [], removed: [], failure: undefined }
    const stopped = commandDeps({ installBundledSkills: () => Promise.resolve(result) }, false)
    await runBundledSkillsInstall(stopped.run)
    expect(stopped.confirmRestart).not.toHaveBeenCalled()
    const later = commandDeps({ installBundledSkills: () => Promise.resolve(result) }, true, false)
    await runBundledSkillsInstall(later.run)
    expect(later.restart).not.toHaveBeenCalled()
  })

  it('names the folder and the reason of a failure, and of a failed undo, without a restart offer', async () => {
    const t = commandDeps({
      installBundledSkills: () =>
        Promise.resolve({
          tag: 'v0.7.0',
          installed: [],
          skipped: [],
          removed: [],
          failure: { folder: '/c/muse/s/high-quality-projects-skill', reason: { kind: 'notOurs' } },
          undoFailure: {
            folder: '/c/muse/skills/x',
            reason: { kind: 'error', message: 'EBUSY: resource busy' },
          },
        }),
    })
    await runBundledSkillsInstall(t.run)
    expect(t.said).toEqual([])
    expect(t.errors).toEqual([
      'The bundled skills could not be installed at /c/muse/s/high-quality-projects-skill: a folder of that name exists that Muse Spark did not install, so it was left alone',
      'The bundled skills could not be installed at /c/muse/skills/x: EBUSY: resource busy',
    ])
    expect(t.confirmRestart).not.toHaveBeenCalled()
  })

  it('says what Remove removed, or that there was nothing to remove', async () => {
    const t = commandDeps({
      removeBundledSkills: () =>
        Promise.resolve({ removed: ['project_setup'], hadCopy: true, failure: undefined }),
    })
    await runBundledSkillsRemove(t.run)
    expect(t.said).toEqual([
      'Removed 1 bundled skill from Muse Code: project_setup',
      UI_TEXT.restartedNotice,
    ])
    const none = commandDeps({
      removeBundledSkills: () =>
        Promise.resolve({ removed: [], hadCopy: false, failure: undefined }),
    })
    await runBundledSkillsRemove(none.run)
    expect(none.said).toEqual([UI_TEXT.bundledSkillsNothingToRemove])
    expect(none.confirmRestart).not.toHaveBeenCalled()
  })

  it('says only why when Remove stopped before its first link', async () => {
    const t = commandDeps({
      removeBundledSkills: () =>
        Promise.resolve({
          removed: [],
          hadCopy: true,
          failure: { folder: '/c/muse/skills', reason: { kind: 'error', message: 'EACCES' } },
        }),
    })
    await runBundledSkillsRemove(t.run)
    expect(t.said).toEqual([])
    expect(t.errors).toEqual(['The bundled skills could not be removed at /c/muse/skills: EACCES'])
    // Nothing changed, so nothing to restart for.
    expect(t.confirmRestart).not.toHaveBeenCalled()
  })
})

describe('the extension’s own skills (M97)', () => {
  it('repoints legal links across extension versions and removes stale-version links', async () => {
    const f = fixture('v0.7.0')
    const oldRoot = path.join(
      f.root,
      'extensions',
      'randynorthrup.muse-spark-code-0.12.0',
      'skills',
    )
    const newRoot = path.join(
      f.root,
      'extensions',
      'randynorthrup.muse-spark-code-0.12.1',
      'skills',
    )
    for (const root of [oldRoot, newRoot])
      writeFile(path.join(root, 'legal', 'SKILL.md'), '---\nname: legal\n---\n')
    await installBundledSkills({ ...deps(f), extensionSkillsRoot: oldRoot })
    const updated = await installBundledSkills({ ...deps(f), extensionSkillsRoot: newRoot })
    expect(updated.skipped).toEqual([])
    expect(updated.installed).toContain('legal')
    expect(leadsTo(path.join(f.skillsRoot, 'legal'))).toBe(path.join(newRoot, 'legal'))
    await fs.unlink(path.join(f.skillsRoot, 'legal'))
    await fs.symlink(
      path.join(oldRoot, 'legal'),
      path.join(f.skillsRoot, 'legal'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const removed = await removeBundledSkills({ ...f, extensionSkillsRoot: newRoot })
    expect(removed.removed).toContain('legal')
    expect(existsSync(path.join(f.skillsRoot, 'legal'))).toBe(false)
  })
  it('removes a dangling legal link from a prior extension version without a marked copy', async () => {
    const f = fixture('v0.7.0')
    const oldInstall = path.join(f.root, 'extensions', 'randynorthrup.muse-spark-code-0.12.0')
    const newRoot = path.join(
      f.root,
      'extensions',
      'randynorthrup.muse-spark-code-0.12.1',
      'skills',
    )
    const oldSkill = path.join(oldInstall, 'skills', 'legal')
    writeFile(path.join(oldSkill, 'SKILL.md'), '---\nname: legal\n---\n')
    mkdirSync(f.skillsRoot, { recursive: true })
    const link = path.join(f.skillsRoot, 'legal')
    symlinkSync(oldSkill, link, process.platform === 'win32' ? 'junction' : 'dir')
    await removeFolder(oldInstall)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    const removed = await removeBundledSkills({ ...f, extensionSkillsRoot: newRoot })
    expect(removed).toMatchObject({ removed: ['legal'], hadCopy: false, failure: undefined })
    await expect(fs.lstat(link)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps another extension and user link when updating or removing legal skills', async () => {
    const f = fixture('v0.7.0', IDS, ['legal'])
    const userSkill = path.join(f.root, 'other.muse-spark-code-0.12.0', 'skills', 'legal')
    writeFile(path.join(userSkill, 'SKILL.md'), 'mine')
    mkdirSync(f.skillsRoot, { recursive: true })
    symlinkSync(
      userSkill,
      path.join(f.skillsRoot, 'legal'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const updated = await installBundledSkills(deps(f))
    expect(updated.skipped).toContain('legal')
    await removeBundledSkills(f)
    expect(leadsTo(path.join(f.skillsRoot, 'legal'))).toBe(userSkill)
  })
  it('links the legal skill straight at the extension, beside the copied package', async () => {
    const f = fixture('v0.7.0', IDS, ['legal'])
    const result = await installBundledSkills(deps(f))
    expect(result.failure).toBeUndefined()
    expect(result.installed).toEqual([...IDS, 'legal'])
    const link = path.join(f.skillsRoot, 'legal')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(leadsTo(link)).toBe(path.join(f.root, 'skills', 'legal'))
    // No copy involved: the package copy holds only its own skills.
    expect(sorted(readdirSync(path.join(f.copy, 'skills')))).toEqual(sorted(IDS))
  })

  it('lists it in status with the vendored ids', async () => {
    const f = fixture('v0.7.0', IDS, ['legal'])
    const before = await bundledSkillsStatus(f)
    expect(before).toMatchObject({ kind: 'notInstalled', skillIds: [...IDS, 'legal'] })
    await installBundledSkills(deps(f))
    const after = await bundledSkillsStatus(f)
    expect(after).toMatchObject({ kind: 'installed', skillIds: [...IDS, 'legal'] })
  })

  it('skips a user-owned name and leaves the folder alone', async () => {
    const f = fixture('v0.7.0', IDS, ['legal'])
    writeFile(path.join(f.skillsRoot, 'legal', 'OWN.md'), 'mine\n')
    const result = await installBundledSkills(deps(f))
    expect(result.failure).toBeUndefined()
    expect(result.skipped).toEqual(['legal'])
    expect(readFileSync(path.join(f.skillsRoot, 'legal', 'OWN.md'), 'utf8')).toBe('mine\n')
  })

  it('removes its link with the copy, and without one', async () => {
    const f = fixture('v0.7.0', IDS, ['legal'])
    await installBundledSkills(deps(f))
    const removed = await removeBundledSkills(f)
    expect(removed.failure).toBeUndefined()
    expect(sorted(removed.removed)).toEqual(sorted([...IDS, 'legal']))
    expect(existsSync(path.join(f.skillsRoot, 'legal'))).toBe(false)

    const g = fixture('v0.7.0', IDS, ['legal'])
    await installBundledSkills(deps(g))
    await removeFolder(g.copy)
    const orphaned = await removeBundledSkills(g)
    expect(orphaned).toMatchObject({ removed: ['legal'], hadCopy: false, failure: undefined })
    expect(existsSync(path.join(g.skillsRoot, 'legal'))).toBe(false)
  })

  it('ignores entries without a SKILL.md or a matching id', async () => {
    const f = fixture()
    writeFile(path.join(f.root, 'skills', 'legal', 'SKILL.md'), '---\nname: legal\n---\n')
    writeFile(path.join(f.root, 'skills', 'notes.txt'), 'not a skill\n')
    mkdirSync(path.join(f.root, 'skills', 'empty'))
    writeFile(path.join(f.root, 'skills', 'Bad-Id', 'SKILL.md'), '---\nname: x\n---\n')
    const extended = { ...f, extensionSkillsRoot: path.join(f.root, 'skills') }
    const result = await installBundledSkills(deps(extended))
    expect(result.failure).toBeUndefined()
    expect(result.installed).toEqual([...IDS, 'legal'])
    const status = await bundledSkillsStatus(extended)
    expect(status.skillIds).toEqual([...IDS, 'legal'])
  })
})
