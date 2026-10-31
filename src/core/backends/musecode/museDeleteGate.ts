// History's Delete gate for a Muse Code host (PLAN.md D26). This module
// lives outside the activation graph on purpose: no module the activation
// bundle includes may import it, so `dist/extension.js` carries none of it
// (the lane K activation budget). It is evaluated by deferred consumers and
// by the lifecycle-reader injection when that lands and wires the offer;
// `test/unit/sessionDelete.test.ts` pins its table meanwhile.
import { MUSE_DELETE_FIRST_VERSION, MUSE_DELETE_REMOVED_VERSION } from '../../../shared/constants'
import { compareVersions, isVersion } from '../../whatsNew/whatsNewVersions'

// Installed build labels (`1.4.4-R5419.1`) name the same release, not a
// semver prerelease (the controller strips them the same way for D26).
const BUILD_LABEL_SUFFIX = /-R\d+\.\d+$/

/**
Whether History may offer Delete on a Muse Code host: its CLI serves
`session/delete` (new in 1.4.0, gone from 1.4.4 on, PLAN.md D26) and a
delete-capable lifecycle reader (one that implements
`parseDeleteAdmission`, which no served capture yet allows) is injected.
Unknown versions stay refused: nothing is sent that the CLI cannot answer.
*/
export function canDeleteMuseSession(serverVersion: string, hasLifecycleReader: boolean): boolean {
  if (!hasLifecycleReader) {
    return false
  }
  const version = serverVersion.replace(BUILD_LABEL_SUFFIX, '')
  return (
    isVersion(version) &&
    compareVersions(version, MUSE_DELETE_FIRST_VERSION) >= 0 &&
    compareVersions(version, MUSE_DELETE_REMOVED_VERSION) < 0
  )
}
