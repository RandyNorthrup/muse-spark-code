import { build } from 'esbuild'
import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
await build({
  stdin: {
    contents: `import './test/hosts/xcode/fake-runtime.ts';`,
    resolveDir: root,
    sourcefile: 'xcode-test-launcher.ts',
    loader: 'ts',
  },
  outfile: path.join(root, 'temp/m104x/fake-runtime.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})
const quote = (value) => `'${value.replaceAll("'", String.raw`'\''`)}'`
await writeFile(
  path.join(root, 'temp/m104x/fake-runtime'),
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, 'temp/m104x/fake-runtime.mjs'))}\n`,
)
await chmod(path.join(root, 'temp/m104x/fake-runtime'), 0o700)
