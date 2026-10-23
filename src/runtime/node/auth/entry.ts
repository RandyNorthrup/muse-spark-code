import { setUiText } from '../../../shared/l10n/text'
import type { UiText } from '../../../shared/l10n/en'
import { NodePasskeyAuth, type NodeAuthOptions } from './service'
export { nodeAuthMethods } from './methods'
export {
  checkNodeCertificate,
  checkNodeNames,
  issueNodeCertificate,
  readNodeChallengeKey,
} from '../tls/certificate'

/** N loads dist/nodeAuth.js on first setup/sign-in, installing its own language table. */
export function createNodePasskeyAuth(
  options: NodeAuthOptions,
  table: UiText,
  locale: string,
): NodePasskeyAuth {
  setUiText(table, locale)
  return new NodePasskeyAuth(options)
}
