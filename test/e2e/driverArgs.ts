// A required `--name value` argument of a driver process. Its own module, with
// no imports: the drivers are bundled alone and must not drag the rig (esbuild
// itself) into their output.
export function rigArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined || value === '') throw new Error(`missing --${name}`)
  return value
}
