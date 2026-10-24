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
// metafile can omit code that remains in a staged shared browser chunk. Each
// is one output file (POSIX separators) and the package directory that put
// bytes in it.
function* packageContributions(metafiles, read, includesOutput) {
  for (const file of metafiles) {
    const meta = JSON.parse(read(file, 'utf8'))
    for (const [outputFile, output] of Object.entries(meta.outputs)) {
      const outputPath = outputFile.replaceAll('\\', '/')
      if (!includesOutput(outputPath)) continue
      for (const [input, contribution] of Object.entries(output.inputs)) {
        const directory = noticePackageDir(input)
        if (directory !== undefined && contribution.bytesInOutput > 0)
          yield { output: outputPath, directory }
      }
    }
  }
}

export function contributedPackageDirs(
  metafiles,
  read = readFileSync,
  includesOutput = () => true,
) {
  const directories = new Set()
  for (const { directory } of packageContributions(metafiles, read, includesOutput))
    directories.add(directory)
  return directories
}

// The output files that carry a third-party package's bytes, sorted: the
// bundles a notices file speaks for, read from the same contributions as its
// packages, so the two cannot drift apart.
export function contributingOutputs(metafiles, read = readFileSync, includesOutput = () => true) {
  const outputs = new Set()
  for (const { output } of packageContributions(metafiles, read, includesOutput))
    outputs.add(output)
  return [...outputs].toSorted((a, b) => a.localeCompare(b, 'en'))
}
