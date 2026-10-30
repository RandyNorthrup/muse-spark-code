// The environment a test gives a runtime process it starts: no credential
// variable, and every per-user folder the runtime reads (home, profile,
// local and roaming data, the XDG folders) inside the test's own home.
import path from 'node:path'
import { withoutCredentials } from '../../../src/runtime/credentialVariables'

export function isolatedRuntimeEnvironment(home: string, gitCeiling: string): NodeJS.ProcessEnv {
  return {
    ...withoutCredentials(process.env),
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(home, 'local'),
    APPDATA: path.join(home, 'roaming'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_STATE_HOME: path.join(home, 'state'),
    GIT_CEILING_DIRECTORIES: gitCeiling,
  }
}
