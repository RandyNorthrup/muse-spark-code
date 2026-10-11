// Keep team tool JSON schemas identical to the production zod boundaries.
import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'

const output = 'src/shared/teamToolSchemas.json'
const { outputFiles } = await build({
  stdin: {
    contents:
      "export * as z from 'zod/mini'; export { teamSchedulerFieldsSchema, teamMergeOptionsSchema, teamRescheduleSchema } from './src/shared/team'",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'silent',
})
const { z, ...schemas } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
const text = await format(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema, { io: 'input' }),
      ]),
    ),
  ),
  { ...(await resolveConfig(output)), filepath: output },
)
if (process.argv.includes('--write')) await writeFile(output, text)
else if ((await readFile(output, 'utf8')) !== text)
  throw new Error('Team tool schemas are stale: node scripts/team-tool-schemas.mjs --write')
console.log(`team tool schemas: ${process.argv.includes('--write') ? 'written' : 'unchanged'}`)
