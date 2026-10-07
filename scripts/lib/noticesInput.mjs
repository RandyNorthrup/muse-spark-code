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
