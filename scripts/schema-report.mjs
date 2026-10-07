// report-v1 is generated from the same zod boundary every host consumes.
import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { format, resolveConfig } from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const entry = JSON.parse(
  await readFile(path.join(root, 'docs/schemas/report-v1.entry.json'), 'utf8'),
)
const { outputFiles } = await esbuild.build({
  stdin: {
    contents: `export * as z from 'zod/mini'; export { ${entry.export} as schema } from './${entry.source}'`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'silent',
})
const { z, schema } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
const generated = { ...z.toJSONSchema(schema), 'x-runtime-invariants': entry.runtimeInvariants }
const file = path.join(root, entry.output)
const bytes = await format(JSON.stringify(generated), {
  ...(await resolveConfig(file)),
  filepath: file,
})
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8')) !== bytes)
    throw new Error('Report schema drift: run npm run schema:report')
} else {
  await writeFile(file, bytes)
}
console.log(process.argv.includes('--check') ? 'Report schema matches.' : 'Report schema written.')
