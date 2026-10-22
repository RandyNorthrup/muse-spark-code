import { describe, expect, it } from 'vitest'
import { TOOL_IMAGE_PREVIEW_MAX_BYTES } from '../../src/shared/constants'
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
    readBytes: (fsPath) => {
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
      code: 'outside_workspace',
      reason: 'path ../etc/x.png is outside the workspace',
    })
    await expect(loadToolImage('out.png', ROOT, 'linux', files)).resolves.toEqual({
      ok: false,
      code: 'outside_workspace',
      reason: 'path out.png leads outside the workspace through a link',
    })
    expect(files.reads).toEqual([])
  })

  it('refuses what is not a picture, a picture too large for the panel preview, and a window with no folder', async () => {
    // D121: the preview keeps its own display bound (the model still reads
    // the image whole through the read tools).
    const large = new Uint8Array(TOOL_IMAGE_PREVIEW_MAX_BYTES + 1)
    const files = io({ '/work/big.jpg': large, '/work/notes.md': PNG })
    await expect(loadToolImage('notes.md', ROOT, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: 'notes.md is not an image the panel shows',
    })
    await expect(loadToolImage('big.jpg', ROOT, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: `big.jpg is larger than ${String(TOOL_IMAGE_PREVIEW_MAX_BYTES)} bytes`,
    })
    await expect(loadToolImage('a.png', undefined, 'linux', files)).resolves.toEqual({
      ok: false,
      reason: 'no folder is open',
    })
    expect(files.reads).toEqual([])
  })

  it('reads the checked image when a link retargets after confinement', async () => {
    const inside = new Uint8Array([1, 2, 3])
    const outside = new Uint8Array([4, 5, 6])
    let target = '/work/safe/dot.png'
    const files = {
      realPath: (fsPath: string) => {
        if (fsPath !== '/work/link/dot.png') {
          return Promise.resolve(fsPath)
        }
        const checked = target
        target = '/work/outside/dot.png'
        return Promise.resolve(checked)
      },
      fileSize: () => Promise.resolve(inside.length),
      readFile: (fsPath: string) =>
        Promise.resolve(fsPath === '/work/link/dot.png' ? outside : inside),
      readBytes: (fsPath: string) =>
        Promise.resolve(fsPath === '/work/link/dot.png' ? outside : inside),
    }
    await expect(loadToolImage('link/dot.png', ROOT, 'linux', files)).resolves.toEqual({
      ok: true,
      dataUri: `data:image/png;base64,${Buffer.from(inside).toString('base64')}`,
    })
  })

  it('refuses a file grown beyond the preview bound after stale metadata', async () => {
    const overLimit = new Uint8Array(TOOL_IMAGE_PREVIEW_MAX_BYTES + 1)
    const files = {
      realPath: (fsPath: string) => Promise.resolve(fsPath),
      fileSize: () => Promise.resolve(4),
      readFile: () => Promise.resolve(overLimit),
      readBytes: (_fsPath: string, maxBytes: number) =>
        Promise.resolve(overLimit.length > maxBytes ? undefined : overLimit),
    }
    const result = await loadToolImage('grown.png', ROOT, 'linux', files)
    expect(result.ok).toBe(false)
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
