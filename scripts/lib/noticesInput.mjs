import { readFileSync } from 'node:fs'

const NODE_MODULES = 'node_modules/'

// Esbuild names the resource parser's cloned inputs with its namespace.
export function noticePackageDir(input) {
  const file = input.replace(/^resource-validation:/, '').replaceAll('\\', '/')
  if (!file.includes(NODE_MODULES)) return
  const at = file.lastIndexOf(NODE_MODULES) + NODE_MODULES.length
  const [scopeOrName = '', name = ''] = file.slice(at).split('/', 2)
  const packageName = scopeOrName.startsWith('@') ? `${scopeOrName}/${name}` : scopeOrName
  return file.slice(0, at) + packageName
}

// Read physical output contributions, including shared chunks; an entry-only
// metafile can omit code that remains in a staged shared browser chunk.
export function contributedPackageDirs(
  metafiles,
  read = readFileSync,
  includesOutput = () => true,
) {
  const directories = new Set()
  for (const file of metafiles) {
    const meta = JSON.parse(read(file, 'utf8'))
    for (const [outputFile, output] of Object.entries(meta.outputs)) {
      if (!includesOutput(outputFile.replaceAll('\\', '/'))) continue
      for (const [input, contribution] of Object.entries(output.inputs)) {
        const directory = noticePackageDir(input)
        if (directory !== undefined && contribution.bytesInOutput > 0) directories.add(directory)
      }
    }
  }
  return directories
}
