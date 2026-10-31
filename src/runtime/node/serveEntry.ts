import path from 'node:path'
import process from 'node:process'
import { hasResourceAdmission } from '../../core/resources/admission'
import { NODE_RESOURCES_DIRECTORY } from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { lazyRuntimeResources } from '../resources/load'
import { resourceFailureReporter } from '../resources/text'
import { stderrLogger } from '../stderrLog'
import { serveNode, type ServeNodeOptions } from './serve'

/** N loads dist/nodeServe.js when serve starts, installing its own language table. */
export async function runNodeServe(
  options: ServeNodeOptions,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  // The service's governed launches (OpenSSL for its certificate, git, the
  // tools) are admitted by this process's one governor. The runtime's own
  // process (`muse-spark-code-acp node serve`) has configured one already; the
  // standalone dist/node.js, which the service unit and the container start,
  // configures it here, with its files under the node's own data root. Nothing
  // loads until the first governed launch.
  const log = stderrLogger((line) => {
    process.stderr.write(`${line}\n`)
  }, 'warn')
  const resources = hasResourceAdmission()
    ? undefined
    : lazyRuntimeResources({
        distDir: __dirname,
        machineDir: path.join(options.store.files.root, NODE_RESOURCES_DIRECTORY),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        log,
        onError: resourceFailureReporter(log),
      })
  try {
    await serveNode(options)
  } finally {
    resources?.dispose()
  }
}
