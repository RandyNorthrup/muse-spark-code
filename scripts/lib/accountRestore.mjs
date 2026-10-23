// C-M108-2: release text and compatibility markers follow the same owner gate.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'
import ts from 'typescript'

/** Remove only this lane's entries from an integrated Settings registry. */
function restoreSettingsRegistry(content, settings) {
  const tree = ts.createSourceFile('settingsAvailability.ts', content, ts.ScriptTarget.Latest, true)
  const keys = new Set(settings.flatMap((key) => [key, `museSpark.${key}`]))
  const hasKey = (node) => {
    return (ts.isStringLiteral(node) || ts.isIdentifier(node)) && keys.has(node.text)
      ? true
      : ts.forEachChild(node, hasKey) === true
  }
  let hasRegistry = false
  const result = ts.transform(tree, [
    (context) => {
      const visit = (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'UNAVAILABLE_SETTINGS'
        ) {
          hasRegistry = true
          const prune = (entry) => {
            if (ts.isArrayLiteralExpression(entry))
              return context.factory.updateArrayLiteralExpression(
                entry,
                entry.elements.filter((row) => !hasKey(row)),
              )
            return ts.isObjectLiteralExpression(entry)
              ? context.factory.updateObjectLiteralExpression(
                  entry,
                  entry.properties.filter((row) => !hasKey(row)),
                )
              : ts.visitEachChild(entry, prune, context)
          }
          return ts.visitEachChild(node, prune, context)
        }
        return ts.visitEachChild(node, visit, context)
      }
      return (node) => ts.visitNode(node, visit)
    },
  ])
  try {
    if (!hasRegistry) throw new Error('Account restore cannot find UNAVAILABLE_SETTINGS')
    return ts.createPrinter().printFile(result.transformed[0])
  } finally {
    result.dispose()
  }
}

/** Pure patch planner: tests flip the owner gate without touching working files. */
export function accountReleaseFiles(files, isComplete, register, pendingByFile) {
  const output = new Map(files)
  const manifest = JSON.parse(output.get('package.json'))
  for (const item of register.items) {
    switch (item.kind) {
      case 'setting': {
        const property = manifest.contributes.configuration.properties[`museSpark.${item.setting}`]
        if (isComplete) delete property.deprecationMessage
        else property.deprecationMessage = `%config.${item.setting}.description%`
        for (const [file, description] of Object.entries(item.descriptions)) {
          const table = JSON.parse(output.get(file))
          table[`config.${item.setting}.description`] = isComplete
            ? description
            : pendingByFile[file]
          output.set(file, JSON.stringify(table, null, 2) + '\n')
        }
        continue
      }
      case 'text': {
        const current = output.get(item.file)
        const desired = isComplete ? item.restored : item.held
        const previous = isComplete ? item.held : item.restored
        if (!current.includes(desired) && !current.includes(previous))
          throw new Error(`Account restore anchor missing: ${item.id} ${item.file}`)
        output.set(
          item.file,
          current.includes(desired) ? current : current.replace(previous, () => desired),
        )
        continue
      }
      case 'help': {
        // Published and compact Help are restored by their gate-aware readers.
        continue
      }
      case 'registry': {
        if (isComplete && output.has(item.file))
          output.set(item.file, restoreSettingsRegistry(output.get(item.file), item.settings))
        continue
      }
      case 'present': {
        if (!output.get(item.file).includes(item.text))
          throw new Error(`Accepted account policy missing: ${item.id}`)
        continue
      }
      default: {
        throw new Error(`Unknown account restore kind: ${item.kind}`)
      }
    }
  }
  output.set('package.json', JSON.stringify(manifest, null, 2) + '\n')
  return output
}

/** Fixed account metadata/pinning remains; only pooling's held Help row changes. */
export function accountReleaseReference(model, isComplete) {
  return {
    ...model,
    cli: model.cli.filter((row) => isComplete || row.name !== 'exec: --account-pool'),
  }
}

export async function generateAccountRelease(root, isComplete, english, isCheck) {
  const register = JSON.parse(
    readFileSync(path.join(root, 'docs/certification/cm1082-restore.json'), 'utf8'),
  )
  const names = [
    ...new Set([
      'package.json',
      ...register.items.flatMap((item) =>
        item.kind === 'setting'
          ? Object.keys(item.descriptions)
          : [item.file].filter((file) => file !== undefined),
      ),
    ]),
  ].filter((file) => existsSync(path.join(root, file)))
  const files = new Map(names.map((file) => [file, readFileSync(path.join(root, file), 'utf8')]))
  const pendingByFile = Object.fromEntries(
    names
      .filter((file) => file.startsWith('package.nls'))
      .map((file) => {
        const locale =
          file === 'package.nls.json'
            ? undefined
            : file.slice('package.nls.'.length, -'.json'.length)
        const table =
          locale === undefined
            ? english
            : JSON.parse(readFileSync(path.join(root, `l10n/ui.${locale}.json`), 'utf8'))
        return [file, table.accounts.certificationPending]
      }),
  )
  const output = accountReleaseFiles(files, isComplete, register, pendingByFile)
  for (const [file, content] of output) {
    if (content === files.get(file)) continue
    const formatted = await format(content, {
      ...(await resolveConfig(path.join(root, file))),
      filepath: path.join(root, file),
    })
    if (formatted === files.get(file)) continue
    if (isCheck)
      throw new Error(`Account availability text is stale: ${file}; npm run reference:generate`)
    writeFileSync(path.join(root, file), formatted)
  }
}
