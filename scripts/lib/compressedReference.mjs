// Node's lazy reference keeps the exact generated model and validation schema.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync } from 'node:zlib'

export const compressedReference = {
  name: 'compressed-reference',
  setup(build) {
    build.onLoad({ filter: /[/\\]reference\.generated\.ts$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8')
      const schemaStart = source.indexOf('const plainTextSchema =')
      const dataStart = source.indexOf('export function referenceModel()')
      if (schemaStart === -1 || dataStart === -1) throw new Error('Reference schema disappeared')
      const data = readFileSync(path.join(path.dirname(args.path), 'reference.generated.json'))
      const packed = brotliCompressSync(data).toString('base64')
      return {
        contents: `${source.slice(0, dataStart)}
import { brotliDecompressSync } from 'node:zlib';
export function referenceModel(): ReferenceModel { return parseReferenceModel(JSON.parse(brotliDecompressSync(Buffer.from(${JSON.stringify(packed)}, 'base64')).toString('utf8'))) }
${source.slice(schemaStart)}`,
        loader: 'ts',
        resolveDir: path.dirname(args.path),
      }
    })
  },
}
