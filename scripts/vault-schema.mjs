// Generated from the same zod boundaries used by the broker and its clients.
import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const { outputFiles } = await build({
  stdin: {
    contents:
      "export * as z from 'zod/mini'; export { vaultAuthorizationResultSchema } from './src/shared/vaultProtocol'; export { vaultIssuerSchema } from './src/shared/vault'",
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
const { z, vaultAuthorizationResultSchema, vaultIssuerSchema } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
for (const [name, schema] of [
  ['authorization-result', z.toJSONSchema(vaultAuthorizationResultSchema)],
  ['issuer', { ...z.toJSONSchema(vaultIssuerSchema), format: 'uri' }],
]) {
  const file = path.join(root, `docs/schemas/vault-${name}-v1.schema.json`)
  const bytes = await format(JSON.stringify(schema), {
    ...(await resolveConfig(file)),
    filepath: file,
  })
  if (process.argv.includes('--check')) {
    if ((await readFile(file, 'utf8')) !== bytes) throw new Error(`Vault schema drift: ${name}`)
  } else await writeFile(file, bytes)
}
