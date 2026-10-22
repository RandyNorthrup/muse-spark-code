// M100 phase 2, lane V: dispatch input manifests are verified before the
// worker starts. No listener beyond loopback, no model calls.
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isProtectedPath } from '../../src/core/protectedPaths'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  buildInputManifest,
  deviceInputManifestDigest,
  deviceInputManifestSchema,
  verifyDispatchInputs,
  type DeviceInputManifest,
  type DeviceInputReader,
} from '../../src/core/devices/inputManifest'
import { deviceGrant, deviceLane } from './helpers/deviceFixtures'

const BASE_COMMIT = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const PLAN_DIGEST = 'c'.repeat(64)
const NOTES_DIGEST = 'd'.repeat(64)

function laneDispatch() {
  const grant = deviceGrant('0'.repeat(32))
  const dispatch = deviceLane(grant)
  const manifest = buildInputManifest({
    identity: dispatch.identity,
    baseCommit: BASE_COMMIT,
    tree: TREE,
    items: [
      { path: 'plans/q3.md', digest: PLAN_DIGEST, bytes: 120 },
      { path: 'context/notes.md', digest: NOTES_DIGEST, bytes: 0 },
    ],
  })
  const bound = {
    ...dispatch,
    snapshot: {
      baseCommit: BASE_COMMIT,
      tree: TREE,
      manifestDigest: deviceInputManifestDigest(manifest),
    },
  }
  return { dispatch: bound, manifest }
}

function workerCopy(entries: ReadonlyMap<string, string>, bases: readonly string[]) {
  const readPaths: string[] = []
  const checkedBases: string[] = []
  const reader: DeviceInputReader = {
    readInput: (path: string) => {
      readPaths.push(path)
      const digest = entries.get(path)
      return Promise.resolve(
        digest === undefined ? undefined : { digest, bytes: path === 'plans/q3.md' ? 120 : 0 },
      )
    },
    hasBaseObject: (id: string) => {
      checkedBases.push(id)
      return Promise.resolve(bases.includes(id))
    },
  }
  return { reader, readPaths, checkedBases }
}

const fullCopy = () =>
  workerCopy(
    new Map([
      ['plans/q3.md', PLAN_DIGEST],
      ['context/notes.md', NOTES_DIGEST],
    ]),
    [BASE_COMMIT, TREE],
  )

async function expectRefusedPath(inputPath: string): Promise<void> {
  const { dispatch, manifest } = laneDispatch()
  const candidate = {
    ...manifest,
    items: [{ path: inputPath, digest: PLAN_DIGEST, bytes: 0 }],
  }
  expect(() => buildInputManifest(candidate), inputPath).toThrow('invalid-frame')
  expect(deviceInputManifestSchema.safeParse(candidate).success, inputPath).toBe(false)
  const copy = fullCopy()
  await expect(verifyDispatchInputs(dispatch, candidate, copy.reader)).rejects.toThrow(
    'invalid-frame',
  )
  expect(copy.checkedBases, inputPath).toEqual([])
  expect(copy.readPaths, inputPath).toEqual([])
}

describe('dispatch input manifests (lane V)', () => {
  // Every non-portable spelling named by RVM100P2V, VB and VC, including
  // the absolute/device examples that only reached the extracted helpers.
  it.each([
    String.raw`plans\q3.md`,
    'plans//q3.md',
    'plans/q3.md/',
    '/plans/q3.md',
    './plan',
    'a/../b',
    'plans/q3.md.',
    'plans/q3.md ',
    '.git./config',
    'plans../q3.md',
    'plans. /q3.md',
    'plans./q3.md',
    'foo../b',
    'foo. /b',
    'a../child',
    'a. /child',
    'a./child',
    'name. .',
    '.. ',
    '...',
    '.../child',
    'repo/.GiT. /hooks/pre-commit',
    '.github. /workflows. /build.yml',
    'AGENTS.md. ',
    String.raw`.Claude\settings.json`,
    String.raw`pLaNs.\Q3.MD. `,
    'aux',
    'AUX',
    'aux.txt',
    'AuX.TXT. ',
    'nul',
    'NUL. ',
    'NUL.txt',
    'COM1.txt',
    'com1.TXT',
    'lpt9.log',
    'LPT9.LOG ',
    'CON:',
    String.raw`C:\repo. \other`,
    String.raw`C:\repo\foo..\b`,
    String.raw`C:\REPO. \Plans\q3.md`,
    String.raw`C:\REPO.\Plans\q3.md`,
    String.raw`\\.\C:\repo\file`,
    String.raw`\\.\C:\storage\x`,
    String.raw`\\.\C:\repo\secret`,
    String.raw`\\.` + '\\',
    '//.',
    '\\',
    String.raw`\\.\C:\Foo\..\..`,
    '//?/C:/storage/x',
    String.raw`\\?\C:\repo\..\outside`,
    String.raw`\\?\C:\storage\..\repo\file`,
    String.raw`\\?\C:\foo\.\bar`,
    String.raw`C:\foo\CON:`,
    String.raw`\\.\CON`,
    String.raw`C:\Foo\ `,
    String.raw`C:\Foo\ . . .`,
    String.raw`C:\Foo\ ` + '\\',
    String.raw`C:\Foo\ . . .` + '\\',
    String.raw`C:\Foo\a.` + '\\',
    String.raw`C:\Foo\a. ` + '\\',
    String.raw`C:\Foo\a..` + '\\',
    String.raw`C:\Foo\..` + '\\',
    String.raw`C:\..`,
    String.raw`\\LOCALHOST\Share\Foo\..\..` + '\\',
    '...\\',
    String.raw`C:\foo..\bar\..`,
    String.raw`C:\foo..\bar\..` + '\\',
    String.raw`C:\foo\NUL`,
    String.raw`C:\foo\NUL` + '\\',
    String.raw`COM1.TXT\file1.txt`,
    String.raw`\\?\C:\foo\CON`,
    String.raw`\\?\C:\foo\bar`,
    String.raw`\\?\C:\foo\bar.`,
    String.raw`\\?\UNC\server\share\a`,
    String.raw`\\server\share\a`,
    String.raw`\\?\unc\server\share\a`,
    'git~1/config',
  ])('refuses reviewed spelling before any read: %j', expectRefusedPath)

  it('accepts generated portable segments and the whole-path length boundary', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ._-+@'
    const { manifest } = laneDispatch()
    const generated = Array.from(
      { length: alphabet.length },
      (_, index) => `x${alphabet.charAt(index)}x`,
    )
    for (let seed = 0; seed < 256; seed++) {
      generated.push(
        `x${Array.from(
          { length: 32 },
          (_, offset) => alphabet[(seed * 17 + offset * 31) % alphabet.length],
        ).join('')}x`,
      )
    }
    generated.push('x'.repeat(DEVICE_LIMITS.pathChars))
    for (const inputPath of generated) {
      const candidate = { ...manifest, items: [{ path: inputPath, digest: PLAN_DIGEST, bytes: 0 }] }
      expect(buildInputManifest(candidate).items[0]!.path, inputPath).toBe(inputPath)
      expect(deviceInputManifestSchema.safeParse(candidate).success, inputPath).toBe(true)
    }
  })
  it('refuses generated members of every forbidden class before any read', async () => {
    const punctuation = '\\:<>"|?*~$%#&()[]{}!=,;`'
    const forbiddenCharacters = [
      ...Array.from({ length: punctuation.length }, (_, index) => punctuation.charAt(index)),
      '\u{7F}',
      '\u{E9}',
      '\u{301}',
      '\u{4F60}',
      '\u{2028}',
      '\u{2029}',
      '\u{FEFF}',
      '¹',
      '²',
      '³',
      ...Array.from({ length: 32 }, (_, code) => String.fromCodePoint(code)),
    ]
    for (const character of forbiddenCharacters) {
      await expectRefusedPath(`x${character}x/file.md`)
      await expectRefusedPath(`folder/x${character}x`)
    }
    for (const ending of ['.', ' ']) {
      for (let length = 1; length <= 16; length++) {
        await expectRefusedPath(`folder/name${ending.repeat(length)}`)
        await expectRefusedPath(`name${ending.repeat(length)}/file.md`)
      }
    }
    for (const segment of ['', '.', '..']) {
      await expectRefusedPath(`${segment}/file.md`)
      await expectRefusedPath(`folder/${segment}/file.md`)
      await expectRefusedPath(`folder/${segment}`)
    }
    const devices = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'CONIN$',
      'CONOUT$',
      ...Array.from({ length: 10 }, (_, digit) => [
        `COM${String(digit)}`,
        `LPT${String(digit)}`,
      ]).flat(),
      ...['¹', '²', '³'].flatMap((digit) => [`COM${digit}`, `LPT${digit}`]),
    ]
    for (const device of devices) {
      for (const name of [device, device.toLowerCase()]) {
        for (const suffix of ['', '.txt', ' .txt', ':']) {
          await expectRefusedPath(`folder/${name}${suffix}`)
          await expectRefusedPath(`${name}${suffix}/file.md`)
        }
      }
    }
    await expectRefusedPath('x'.repeat(DEVICE_LIMITS.pathChars + 1))
  })
  it('builds a manifest of content-addressed inputs plus base objects', () => {
    const { manifest } = laneDispatch()
    expect(deviceInputManifestSchema.parse(manifest)).toEqual(manifest)
    expect(manifest.baseCommit).toBe(BASE_COMMIT)
    expect(manifest.tree).toBe(TREE)
    expect(manifest.items.map((item) => item.path)).toEqual(['plans/q3.md', 'context/notes.md'])
  })
  it('binds the digest to every item and base object in fixed order', () => {
    const { manifest } = laneDispatch()
    const serialized = JSON.stringify(manifest)
    const revived = deviceInputManifestSchema.parse(JSON.parse(serialized))
    expect(deviceInputManifestDigest(manifest)).toBe(deviceInputManifestDigest(revived))
    const tampered: DeviceInputManifest = {
      ...manifest,
      items: [{ path: 'plans/q3.md', digest: NOTES_DIGEST, bytes: 120 }],
    }
    expect(deviceInputManifestDigest(tampered)).not.toBe(deviceInputManifestDigest(manifest))
  })
  it('verifies a complete worker copy before start', async () => {
    const { dispatch, manifest } = laneDispatch()
    const copy = fullCopy()
    await expect(verifyDispatchInputs(dispatch, manifest, copy.reader)).resolves.toEqual(manifest)
    expect(copy.readPaths).toEqual(['plans/q3.md', 'context/notes.md'])
    expect(copy.checkedBases).toEqual([BASE_COMMIT, TREE])
  })
  it('refuses a plan file not copied to the worker', async () => {
    const { dispatch, manifest } = laneDispatch()
    const copy = workerCopy(new Map([['context/notes.md', NOTES_DIGEST]]), [BASE_COMMIT, TREE])
    await expect(verifyDispatchInputs(dispatch, manifest, copy.reader)).rejects.toThrow(
      'payload-changed',
    )
    expect(copy.readPaths).toEqual(['plans/q3.md'])
  })
  it('refuses a base commit the worker lacks', async () => {
    const { dispatch, manifest } = laneDispatch()
    const missingBase = workerCopy(
      new Map([
        ['plans/q3.md', PLAN_DIGEST],
        ['context/notes.md', NOTES_DIGEST],
      ]),
      [TREE],
    )
    await expect(verifyDispatchInputs(dispatch, manifest, missingBase.reader)).rejects.toThrow(
      'reconcile-required',
    )
    expect(missingBase.readPaths).toEqual([])
    const missingTree = workerCopy(
      new Map([
        ['plans/q3.md', PLAN_DIGEST],
        ['context/notes.md', NOTES_DIGEST],
      ]),
      [BASE_COMMIT],
    )
    await expect(verifyDispatchInputs(dispatch, manifest, missingTree.reader)).rejects.toThrow(
      'reconcile-required',
    )
    expect(missingTree.readPaths).toEqual([])
  })
  it('refuses mismatched content on the worker', async () => {
    const { dispatch, manifest } = laneDispatch()
    const copy = workerCopy(
      new Map([
        ['plans/q3.md', NOTES_DIGEST],
        ['context/notes.md', NOTES_DIGEST],
      ]),
      [BASE_COMMIT, TREE],
    )
    await expect(verifyDispatchInputs(dispatch, manifest, copy.reader)).rejects.toThrow(
      'payload-changed',
    )
  })
  it('refuses a worker input with a mismatched byte size', async () => {
    const { dispatch, manifest } = laneDispatch()
    const copy = fullCopy()
    const reader: DeviceInputReader = {
      ...copy.reader,
      readInput: async (path) => {
        const found = await copy.reader.readInput(path)
        return found === undefined ? undefined : { ...found, bytes: found.bytes + 1 }
      },
    }
    await expect(verifyDispatchInputs(dispatch, manifest, reader)).rejects.toThrow(
      'payload-changed',
    )
    expect(copy.readPaths).toEqual(['plans/q3.md'])
  })
  it('refuses a manifest the dispatch does not bind', async () => {
    const { dispatch, manifest } = laneDispatch()
    const copy = fullCopy()
    const rebound = {
      ...dispatch,
      snapshot: { ...dispatch.snapshot, manifestDigest: '9'.repeat(64) },
    }
    await expect(verifyDispatchInputs(rebound, manifest, copy.reader)).rejects.toThrow(
      'payload-changed',
    )
    const otherAttempt = buildInputManifest({
      identity: { ...dispatch.identity, attemptId: 'f'.repeat(32) },
      baseCommit: BASE_COMMIT,
      tree: TREE,
      items: manifest.items,
    })
    const reboundAttempt = {
      ...dispatch,
      snapshot: { ...dispatch.snapshot, manifestDigest: deviceInputManifestDigest(otherAttempt) },
    }
    await expect(verifyDispatchInputs(reboundAttempt, otherAttempt, copy.reader)).rejects.toThrow(
      'payload-changed',
    )
    const otherBase = {
      ...dispatch,
      snapshot: { ...dispatch.snapshot, baseCommit: '2'.repeat(40) },
    }
    await expect(verifyDispatchInputs(otherBase, manifest, copy.reader)).rejects.toThrow(
      'payload-changed',
    )
    const otherTree = {
      ...dispatch,
      snapshot: { ...dispatch.snapshot, tree: '2'.repeat(40) },
    }
    await expect(verifyDispatchInputs(otherTree, manifest, copy.reader)).rejects.toThrow(
      'payload-changed',
    )
    expect(copy.readPaths).toEqual([])
    expect(copy.checkedBases).toEqual([])
  })
  it('refuses an unparsable manifest before any worker read', async () => {
    const { dispatch } = laneDispatch()
    const copy = fullCopy()
    const escape: unknown = {
      version: 1,
      identity: dispatch.identity,
      baseCommit: BASE_COMMIT,
      tree: TREE,
      items: [{ path: '../escape.md', digest: PLAN_DIGEST, bytes: 10 }],
    }
    await expect(verifyDispatchInputs(dispatch, escape, copy.reader)).rejects.toThrow(
      'invalid-frame',
    )
    const lengthMismatch: unknown = {
      version: 1,
      identity: dispatch.identity,
      baseCommit: BASE_COMMIT,
      tree: 'b'.repeat(64),
      items: [],
    }
    await expect(verifyDispatchInputs(dispatch, lengthMismatch, copy.reader)).rejects.toThrow(
      'invalid-frame',
    )
    expect(copy.readPaths).toEqual([])
    expect(copy.checkedBases).toEqual([])
  })
  it('refuses an invalid dispatch before any worker read', async () => {
    const { dispatch, manifest } = laneDispatch()
    const copy = fullCopy()
    await expect(
      verifyDispatchInputs({ ...dispatch, grantRevision: 0 }, manifest, copy.reader),
    ).rejects.toThrow('invalid-frame')
    expect(copy.checkedBases).toEqual([])
    expect(copy.readPaths).toEqual([])
  })
  it('refuses more items than the file cap at build', () => {
    const { dispatch } = laneDispatch()
    const items = Array.from({ length: DEVICE_LIMITS.artifactFiles + 1 }, (_, index) => ({
      path: `input-${String(index)}.md`,
      digest: PLAN_DIGEST,
      bytes: 1,
    }))
    expect(() =>
      buildInputManifest({
        identity: dispatch.identity,
        baseCommit: BASE_COMMIT,
        tree: TREE,
        items,
      }),
    ).toThrow('invalid-frame')
  })
  it('refuses unsafe paths, malformed digests, versions and unknown fields', () => {
    const { manifest } = laneDispatch()
    for (const path of ['/absolute', 'a//b', './plan', 'a/../b', 'C:/plan', 'a\nplan']) {
      expect(
        deviceInputManifestSchema.safeParse({
          ...manifest,
          items: [{ path, digest: PLAN_DIGEST, bytes: 0 }],
        }).success,
      ).toBe(false)
    }
    for (const candidate of [
      { ...manifest, version: 2 },
      { ...manifest, extra: true },
      { ...manifest, items: [{ path: 'plan', digest: 'C'.repeat(64), bytes: 0 }] },
      { ...manifest, items: [{ path: 'plan', digest: PLAN_DIGEST, bytes: -1 }] },
      {
        ...manifest,
        items: [{ path: 'plan', digest: PLAN_DIGEST, bytes: DEVICE_LIMITS.artifactBytes + 1 }],
      },
    ]) {
      expect(deviceInputManifestSchema.safeParse(candidate).success).toBe(false)
    }
    const sha256Git = { ...manifest, baseCommit: 'a'.repeat(64), tree: 'b'.repeat(64) }
    expect(deviceInputManifestSchema.parse(sha256Git)).toEqual(sha256Git)
  })
  it('refuses a backslash spelling instead of normalizing it', () => {
    const { manifest } = laneDispatch()
    expect(() =>
      buildInputManifest({
        ...manifest,
        items: [
          manifest.items[0]!,
          { path: String.raw`plans\q3.md`, digest: PLAN_DIGEST, bytes: 120 },
        ],
      }),
    ).toThrow('invalid-frame')
  })
  it.each([
    ['plans/q3.md', 'Plans/q3.md'],
    ['plans/q3.md', 'plans/q3.md.'],
    ['plans/q3.md', 'plans/q3.md '],
    ['aux', 'AUX'],
    ['.git/config', '.git./config'],
    ['plans/q3.md', 'pLaNs/Q3.MD'],
    ['plans/q3.md', 'plans./q3.md. '],
    ['plans/q3.md', String.raw`PLANS\Q3.MD. `],
    ['aux.txt', 'AuX.TXT. '],
    ['nul', 'NUL. '],
    ['COM1.txt', 'com1.TXT'],
    ['lpt9.log', 'LPT9.LOG '],
  ])('refuses Windows identity collisions everywhere: %j / %j', async (first, second) => {
    const { dispatch, manifest } = laneDispatch()
    const candidate = {
      ...manifest,
      items: [first, second].map((inputPath) => ({
        path: inputPath,
        digest: PLAN_DIGEST,
        bytes: 120,
      })),
    }
    expect(() => buildInputManifest(candidate)).toThrow('invalid-frame')
    expect(deviceInputManifestSchema.safeParse(candidate).success).toBe(false)
    const copy = fullCopy()
    await expect(verifyDispatchInputs(dispatch, candidate, copy.reader)).rejects.toThrow(
      'invalid-frame',
    )
    expect(copy.checkedBases).toEqual([])
    expect(copy.readPaths).toEqual([])
  })
  it.each([
    '.GiT/config',
    'repo/.CLAUDE/settings.json',
    '.GitHub/workflows/build.yml',
    'AGENTS.MD',
  ])('compares protected names only after strict validation: %j', (inputPath) => {
    const { manifest } = laneDispatch()
    const candidate = buildInputManifest({
      ...manifest,
      items: [{ path: inputPath, digest: PLAN_DIGEST, bytes: 0 }],
    })
    expect(isProtectedPath(candidate.items[0]!.path)).toBe(true)
  })
  it.runIf(process.platform === 'win32')(
    'opens case-variant Windows spellings as the same native file',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'm100-input-identity-'))
      try {
        await mkdir(path.join(root, 'plans'))
        await writeFile(path.join(root, 'plans/q3.md'), 'plan')
        const first = await open(path.join(root, 'plans/q3.md'), 'r')
        try {
          const second = await open(path.join(root, 'Plans/Q3.MD'), 'r')
          try {
            const firstId = await first.stat({ bigint: true })
            const secondId = await second.stat({ bigint: true })
            expect(firstId.ino).not.toBe(0n)
            expect([secondId.dev, secondId.ino]).toEqual([firstId.dev, firstId.ino])
          } finally {
            await second.close()
          }
        } finally {
          await first.close()
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  it('preserves valid portable spelling through verification end to end', async () => {
    const { dispatch } = laneDispatch()
    const manifest = buildInputManifest({
      identity: dispatch.identity,
      baseCommit: BASE_COMMIT,
      tree: TREE,
      items: [{ path: 'plans/q3.md', digest: PLAN_DIGEST, bytes: 120 }],
    })
    const rebound = {
      ...dispatch,
      snapshot: {
        baseCommit: BASE_COMMIT,
        tree: TREE,
        manifestDigest: deviceInputManifestDigest(manifest),
      },
    }
    const copy = workerCopy(new Map([['plans/q3.md', PLAN_DIGEST]]), [BASE_COMMIT, TREE])
    await expect(verifyDispatchInputs(rebound, manifest, copy.reader)).resolves.toEqual(manifest)
    expect(copy.readPaths).toEqual(['plans/q3.md'])
  })
})
