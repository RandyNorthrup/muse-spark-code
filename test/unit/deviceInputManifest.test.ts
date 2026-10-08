// M100 phase 2, lane V: dispatch input manifests are verified before the
// worker starts. Fakes only; no listener beyond loopback, no model calls.
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  buildInputManifest,
  deviceInputManifestDigest,
  deviceInputManifestSchema,
  normalizeManifestPath,
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

describe('dispatch input manifests (lane V)', () => {
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
  it('normalizes Windows separators to forward slashes at build', () => {
    expect(normalizeManifestPath(String.raw`plans\q3.md`)).toBe('plans/q3.md')
    expect(normalizeManifestPath('plans/q3.md')).toBe('plans/q3.md')
    const { manifest: base } = laneDispatch()
    const manifest = buildInputManifest({
      ...base,
      items: [{ ...base.items[0]!, path: String.raw`plans\q3.md` }],
    })
    expect(manifest.items.map((item) => item.path)).toEqual(['plans/q3.md'])
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
  it('refuses duplicate paths after Windows normalization', () => {
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
  it('verifies a manifest built from Windows separators end to end', async () => {
    const { dispatch } = laneDispatch()
    const manifest = buildInputManifest({
      identity: dispatch.identity,
      baseCommit: BASE_COMMIT,
      tree: TREE,
      items: [{ path: String.raw`plans\q3.md`, digest: PLAN_DIGEST, bytes: 120 }],
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
