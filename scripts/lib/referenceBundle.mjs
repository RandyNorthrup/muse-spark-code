import { readFileSync } from 'node:fs'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

// The lazy Node reference keeps the same generated schema and full model.
// Browsers retain the generator's portable pool encoding.
/** @type {import('esbuild').Plugin} */
export const compactNodeReference = {
  name: 'compact-node-reference',
  setup(build) {
    build.onLoad({ filter: /[/\\]reference[/\\]reference\.generated\.ts$/ }, (args) => {
      const jsonPath = args.path.replace(/\.ts$/, '.json')
      const model = JSON.parse(readFileSync(jsonPath, 'utf8'))
      const packed = deflateRawSync(JSON.stringify(model)).toString('base64')
      const source = readFileSync(args.path, 'utf8')
      const body =
        /export function referenceModel\(\): ReferenceModel \{[\s\S]*?(?=const plainTextSchema)/
      if (!body.test(source)) throw new Error('Missing generated reference boundary')
      return {
        contents:
          "import { inflateRawSync } from 'node:zlib'\n" +
          source.replace(
            body,
            () => `export function referenceModel(): ReferenceModel {
              return parseReferenceModel(JSON.parse(inflateRawSync(Buffer.from(${JSON.stringify(packed)}, 'base64')).toString('utf8')))
            }\n`,
          ),
        loader: 'ts',
        resolveDir: path.dirname(args.path),
        watchFiles: [args.path, jsonPath],
      }
    })
  },
}
