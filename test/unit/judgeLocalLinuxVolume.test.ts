import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyLinuxAnchor, verifyLinuxLocalVolume } from '../../src/core/judge/local/linuxVolume'

const rig = vi.hoisted(() => ({
  mountinfo: '',
  magic: 0xef_53,
  fault: '',
  uid: 1000,
}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(() => Promise.resolve(rig.mountinfo)),
  statfs: vi.fn(() => Promise.resolve({ type: rig.magic })),
  realpath: vi.fn((file: string) => Promise.resolve(rig.fault === 'redirect' ? '/other' : file)),
  lstat: vi.fn((file: string) => {
    if (rig.fault === 'permission') return Promise.reject(new Error('EACCES'))
    let uid = rig.uid
    let mode = 0o755
    if (file === '/' || (file === '/store' && rig.fault === 'sticky-root')) uid = 0
    if (rig.fault === 'foreign') uid = 1001
    if (file === '/store' && rig.fault === 'sticky-root') mode = 0o1777
    if (rig.fault === 'writable' || (file === '/store' && rig.fault === 'ancestor')) mode = 0o777
    return Promise.resolve({
      uid,
      mode,
      isSymbolicLink: () => rig.fault === 'symlink',
      isDirectory: () => rig.fault !== 'type',
      isFile: () => rig.fault !== 'type',
    })
  }),
}))
const mount = (point: string, type: string, source = '/dev/sda2') =>
  `25 1 8:2 / ${point} rw,relatime - ${type} ${source} rw`
const signal = () => new AbortController().signal
beforeEach(() => {
  rig.mountinfo = mount('/', 'ext4')
  rig.magic = 0xef_53
  rig.fault = ''
  rig.uid = 1000
})

describe.skipIf(process.platform !== 'linux')('M98 Linux mountinfo/statfs proof', () => {
  it('requires an agreeing local block-device filesystem', async () => {
    await expect(verifyLinuxLocalVolume('/store/models', signal())).resolves.toBeUndefined()
  })
  it.each([
    'nfs',
    'nfs4',
    'cifs',
    '9p',
    'fuse',
    'fuse.sshfs',
    'fuseblk',
    'overlay',
    'tmpfs',
    'unknown',
  ])('refuses a nested %s mount even with local parent and magic', async (type) => {
    rig.mountinfo += `\n${mount('/store', type)}`
    await expect(verifyLinuxLocalVolume('/store/models', signal())).rejects.toThrow(
      'unverified-model-volume',
    )
  })
  it.each(['magic', 'source', 'ambiguous', 'missing', 'malformed'])(
    'refuses %s mount evidence',
    async (fault) => {
      switch (fault) {
        case 'magic': {
          rig.magic = 0x69_69
          break
        }
        case 'source': {
          rig.mountinfo = mount('/', 'ext4', 'server:/share')
          break
        }
        case 'ambiguous': {
          rig.mountinfo += `\n${mount('/', 'ext4')}`
          break
        }
        case 'missing': {
          rig.mountinfo = mount('/elsewhere', 'ext4')
          break
        }
        default: {
          rig.mountinfo = 'invalid row'
        }
      }
      await expect(verifyLinuxLocalVolume('/store/models', signal())).rejects.toThrow(
        'unverified-model-volume',
      )
    },
  )
  it('decodes escaped mountpoints and respects component boundaries', async () => {
    rig.mountinfo += `\n${mount(String.raw`/store\040name`, 'nfs')}`
    await expect(verifyLinuxLocalVolume('/store name/models', signal())).rejects.toThrow(
      'unverified-model-volume',
    )
    await expect(verifyLinuxLocalVolume('/store names/models', signal())).resolves.toBeUndefined()
  })
  it('refuses cancellation before reading evidence', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(verifyLinuxLocalVolume('/store/models', controller.signal)).rejects.toThrow()
  })
})

describe.skipIf(process.platform !== 'linux')('M98 Linux installation anchors', () => {
  it('accepts canonical owner-controlled roots and binaries', async () => {
    await expect(
      verifyLinuxAnchor('/store/models', 1000, 'directory', signal()),
    ).resolves.toBeUndefined()
    await expect(
      verifyLinuxAnchor('/store/ollama', 1000, 'file', signal()),
    ).resolves.toBeUndefined()
  })
  it.each(['redirect', 'symlink', 'foreign', 'writable', 'ancestor', 'permission', 'type'])(
    'refuses %s install/root evidence',
    async (fault) => {
      rig.fault = fault
      await expect(
        verifyLinuxAnchor('/store/models', 1000, 'directory', signal()),
      ).rejects.toThrow()
    },
  )
  it('requires the model store owner to be the exact server UID', async () => {
    rig.uid = 0
    await expect(verifyLinuxAnchor('/store/models', 1000, 'directory', signal())).rejects.toThrow(
      'unverified-installation',
    )
  })
  it('allows a root-owned sticky ancestor but never a writable anchor', async () => {
    rig.fault = 'sticky-root'
    await expect(
      verifyLinuxAnchor('/store/models', 1000, 'directory', signal()),
    ).resolves.toBeUndefined()
  })
})
