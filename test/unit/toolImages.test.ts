import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES } from '../../src/shared/constants'
import { imageMediaTypeOf, loadToolImage, type ToolImageIo } from '../../src/core/toolImages'

const ROOT = '/work'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

/** A workspace of files by absolute path; `links` maps a path to where it really leads. */
function io(
  files: Readonly<Record<string, Uint8Array>>,
  links: Readonly<Record<string, string>> = {},
): ToolImageIo & { readonly reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    realPath: (fsPath) => Promise.resolve(links[fsPath] ?? fsPath),
    fileSize: (fsPath) => Promise.resolve(files[fsPath]?.length ?? 0),
    readFile: (fsPath) => {
      reads.push(fsPath)
      const bytes = files[fsPath]
      return bytes === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(bytes)
    },
  }
}

describe('loadToolImage (M43)', () => {
  it('reads a picture inside the workspace as a data URI of its type', async () => {
    const files = io({ '/work/media/dot.png': PNG })
    await expect(loadToolImage('media/dot.png', ROOT, 'linux', files)).resolves.toEqual({
      ok: true,
      dataUri: 'data:image/png;base64,iVBORw==',
    })
    await expect(loadToolImage('/work/media/dot.png', ROOT, 'linux', files)).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    )
  })

  it('refuses a path outside the workspace, or one a link leads out of, without reading it', async () => {
    const files = io({ '/etc/x.png': PNG, '/work/out.png': PNG }, { '/work/out.png': '/etc/x.png' })
    await expect(loadToolImage('../etc/x.png', ROOT, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: 'path ../etc/x.png is outside the workspace',
    })
    await expect(loadToolImage('out.png', ROOT, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: 'path out.png leads outside the workspace through a link',
    })
    expect(files.reads).toEqual([])
  })

  it('refuses what is not a picture, a picture too large, and a window with no folder', async () => {
    const large = new Uint8Array(MAX_IMAGE_BYTES + 1)
    const files = io({ '/work/big.jpg': large, '/work/notes.md': PNG })
    await expect(loadToolImage('notes.md', ROOT, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: 'notes.md is not an image the panel shows',
    })
    await expect(loadToolImage('big.jpg', ROOT, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: `big.jpg is larger than ${String(MAX_IMAGE_BYTES)} bytes`,
    })
    await expect(loadToolImage('a.png', undefined, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: 'no folder is open',
    })
    expect(files.reads).toEqual([])
  })

  it('knows a picture by its extension, in any case', () => {
    expect(imageMediaTypeOf('A.PNG', 'win32')).toBe('image/png')
    expect(imageMediaTypeOf('photo.jpeg', 'linux')).toBe('image/jpeg')
    expect(imageMediaTypeOf('anim.gif', 'linux')).toBe('image/gif')
    expect(imageMediaTypeOf('pic.webp', 'linux')).toBe('image/webp')
    expect(imageMediaTypeOf('icon.svg', 'linux')).toBeUndefined()
    expect(imageMediaTypeOf('png', 'linux')).toBeUndefined()
  })
})
