import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const normal = (file: string) => file.replaceAll('\\', '/')

describe('M105-A optional browser sound controls', () => {
  it('ships sound controls through a dynamic chunk, outside chip startup', async () => {
    const result = await build({
      entryPoints: ['src/webview/components/AttachmentSound.tsx'],
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      outdir: 'temp/audio-bundle-test',
      write: false,
      metafile: true,
      minify: true,
      external: ['react', 'react/jsx-runtime'],
      logLevel: 'silent',
    })
    const outputs = Object.entries(result.metafile.outputs)
    const entry = outputs.find(
      ([, details]) =>
        details.entryPoint !== undefined &&
        normal(details.entryPoint).endsWith('/AttachmentSound.tsx'),
    )
    const sound = outputs.find(([, details]) =>
      Object.keys(details.inputs).some((file) =>
        normal(file).endsWith('/AudioAttachmentActions.tsx'),
      ),
    )
    if (entry === undefined || sound === undefined)
      throw new Error('Missing attachment or sound output')
    expect(sound[0]).not.toBe(entry[0])
    expect(
      entry[1].imports.some(
        (edge) => edge.kind === 'dynamic-import' && normal(edge.path) === normal(sound[0]),
      ),
    ).toBe(true)
    expect(
      Object.keys(entry[1].inputs).some((file) =>
        normal(file).endsWith('/AudioAttachmentActions.tsx'),
      ),
    ).toBe(false)
  })
})
