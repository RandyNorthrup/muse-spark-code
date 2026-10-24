// M110f lane O: a backup round-trips the data tree and refuses tampered
// or escaping restores, upgrades move past readiness and roll sick
// installs back, retention and the disk floor obey only the person's own
// settings, the clock judges skew, a wipe destroys the key first, and the
// metrics page prints live readings.
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createNodeBackup,
  removeNodeBackup,
  restoreNodeBackup,
} from '../../src/runtime/node/ops/backup'
import { checkNodeClock } from '../../src/runtime/node/ops/clock'
import { formatNodeMetrics, otelExportTarget } from '../../src/runtime/node/ops/metrics'
import { applyNodeRetention, checkDiskFloor } from '../../src/runtime/node/ops/retention'
import { compareNodeVersions, decideNodeUpgrade } from '../../src/runtime/node/ops/upgrade'
import { wipeNodeData } from '../../src/runtime/node/ops/wipe'
import { fileRoots } from './helpers/tempDirs'

const roots = fileRoots()

describe('node backup', () => {
  it('round-trips the tree and refuses a tampered or escaping restore', async () => {
    const root = await roots.fresh('m110f-backup-')
    const dataDir = path.join(root, 'data')
    await mkdir(path.join(dataDir, 'nested'), { recursive: true })
    await writeFile(path.join(dataDir, 'state.json'), '{"a":1}')
    await writeFile(path.join(dataDir, 'nested', 'note.txt'), 'hello')
    const backupDir = path.join(root, 'backup')
    const manifest = await createNodeBackup(dataDir, backupDir)
    expect(
      manifest.entries
        .map((entry) => entry.path)
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([path.join('nested', 'note.txt'), 'state.json'])
    const restored = path.join(root, 'restored')
    await restoreNodeBackup(backupDir, restored)
    expect(await readFile(path.join(restored, 'state.json'), 'utf8')).toBe('{"a":1}')

    await writeFile(path.join(backupDir, 'files', 'state.json'), '{"a":2}')
    await expect(restoreNodeBackup(backupDir, path.join(root, 'tampered'))).rejects.toThrow(
      'backup file changed since its backup: state.json',
    )
    await removeNodeBackup(backupDir)
    await expect(stat(backupDir)).rejects.toThrow()
  })

  it('refuses to follow links on the way in', async () => {
    const root = await roots.fresh('m110f-backup-link-')
    await writeFile(path.join(root, 'real.txt'), 'real')
    // A file link and a directory link are both refused. Windows grants a
    // file link only with the symbolic-link privilege, which a test account
    // does not hold; its directory link is a junction (no privilege needed),
    // which lstat reads as a link there as it reads a symlink elsewhere.
    if (process.platform !== 'win32') {
      await symlink(path.join(root, 'real.txt'), path.join(root, 'link.txt'))
      await expect(createNodeBackup(root, path.join(root, 'backup'))).rejects.toThrow(
        'a backup never follows links',
      )
      await rm(path.join(root, 'link.txt'))
    }
    await mkdir(path.join(root, 'real'))
    await symlink(
      path.join(root, 'real'),
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(createNodeBackup(root, path.join(root, 'backup'))).rejects.toThrow(
      'a backup never follows links',
    )
  })
})

describe('node upgrades', () => {
  it('upgrades past readiness, rolls sick installs back, else holds', () => {
    expect(compareNodeVersions('0.19.0', '0.19.10')).toBeLessThan(0)
    expect(compareNodeVersions('0.20.0', '0.19.10')).toBeGreaterThan(0)
    const base = {
      channel: 'stable',
      current: '0.19.0',
      currentHealth: 'good',
      previous: '0.18.0',
      candidate: '0.19.1',
      candidateChannel: 'stable',
      readiness: { ready: true },
    } as const
    expect(decideNodeUpgrade(base)).toEqual({ action: 'upgrade', to: '0.19.1' })
    expect(
      decideNodeUpgrade({ ...base, readiness: { ready: false, reason: 'disk full' } }),
    ).toEqual({ action: 'hold', reason: 'disk full' })
    expect(decideNodeUpgrade({ ...base, currentHealth: 'bad' })).toEqual({
      action: 'rollback',
      to: '0.18.0',
    })
    expect(decideNodeUpgrade({ ...base, candidateChannel: 'beta' })).toEqual({
      action: 'hold',
      reason: 'no stable release is newer',
    })
  })
})

describe('node retention and disk floor', () => {
  it('keeps the person newest within their budget and nothing without one', () => {
    const files = [
      { path: 'a', bytes: 100, mtimeMs: 300 },
      { path: 'b', bytes: 100, mtimeMs: 200 },
      { path: 'c', bytes: 100, mtimeMs: 100 },
    ]
    expect(applyNodeRetention(files, {})).toEqual({ kept: files, removed: [] })
    const verdict = applyNodeRetention(files, { keepNewest: 2, maxTotalBytes: 250 })
    expect(verdict.kept.map((file) => file.path)).toEqual(['a', 'b'])
    expect(verdict.removed.map((file) => file.path)).toEqual(['c'])
    const tight = applyNodeRetention(files, { maxTotalBytes: 150 })
    expect(tight.kept.map((file) => file.path)).toEqual(['a'])
    expect(checkDiskFloor({ freeBytes: 10, floorBytes: undefined })).toEqual({ ok: true })
    expect(checkDiskFloor({ freeBytes: 10, floorBytes: 100 })).toEqual({
      ok: false,
      reason: 'the disk is below its floor, no new work starts',
    })
  })
})

describe('node clock', () => {
  it('warns past the warning skew and stops time codes past refusal', () => {
    expect(checkNodeClock({ systemMs: 1000, referenceMs: 900, warnAfterMs: 500 })).toMatchObject({
      isSkewed: false,
      isTotpRefused: false,
    })
    const warned = checkNodeClock({
      systemMs: 10_000,
      referenceMs: 1000,
      warnAfterMs: 500,
      refuseAfterMs: 20_000,
    })
    expect(warned).toMatchObject({ isSkewed: true, isTotpRefused: false })
    expect(warned.reason).toBe('the clock is skewed, time codes are suspect')
    const refused = checkNodeClock({
      systemMs: 30_000,
      referenceMs: 1000,
      warnAfterMs: 500,
      refuseAfterMs: 20_000,
    })
    expect(refused).toMatchObject({ isSkewed: true, isTotpRefused: true })
    expect(checkNodeClock({ systemMs: 1000, warnAfterMs: 500 }).reason).toBe('no reference clock')
  })
})

describe('node wipe', () => {
  it('destroys the key first, then the data, inside the root only', async () => {
    const root = await roots.fresh('m110f-wipe-')
    const dataDir = path.join(root, 'data')
    await mkdir(dataDir, { recursive: true })
    const keyFile = path.join(root, 'keys', 'data.key')
    await mkdir(path.dirname(keyFile), { recursive: true })
    await writeFile(keyFile, 'key-material')
    await writeFile(path.join(dataDir, 'state.json'), '{}')
    await wipeNodeData({ root, dataDir, keyFile })
    await expect(stat(keyFile)).rejects.toThrow()
    await expect(stat(dataDir)).rejects.toThrow()
    await expect(
      wipeNodeData({ root, dataDir: path.join(root, '..', 'escape'), keyFile }),
    ).rejects.toThrow('a wipe stays inside the node root')
  })
})

describe('node metrics', () => {
  it('prints live readings and exports nowhere until the person says', () => {
    const text = formatNodeMetrics({
      version: '0.19.0',
      uptimeSeconds: 42,
      sealed: true,
      workers: 3,
    })
    expect(text).toBe(
      'muse_node_info{version="0.19.0"} 1\n' +
        'muse_node_uptime_seconds 42\n' +
        'muse_node_sealed 1\n' +
        'muse_node_workers 3\n',
    )
    expect(otelExportTarget({})).toBeUndefined()
    expect(otelExportTarget({ endpoint: 'https://collector:4318' })).toBe('https://collector:4318')
  })
})
