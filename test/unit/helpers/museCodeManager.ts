import {
  MuseCodeBackendManager,
  type BackendManagerDeps,
} from '../../../src/host/backend/museCodeBackendManager'
import { FakeLogOutputChannel } from './fakes'

/** Test-owned manager dependencies; native spawn occurs only when a fixture permits it. */
export function fakeMuseCodeManager(
  overrides: Partial<BackendManagerDeps> = {},
): MuseCodeBackendManager {
  return new MuseCodeBackendManager({
    beforeWorkspaceHostStart: () => Promise.resolve(),
    log: new FakeLogOutputChannel(),
    extensionVersion: '0.0.0-test',
    getConfiguredBinaryPath: () => '',
    getEnvironmentVariables: () => [],
    workspaceRoot: undefined,
    getShellSandbox: () => 'off',
    getSandboxNetwork: () => 'default',
    userProfileDir: undefined,
    isWorkspaceTrusted: () => true,
    getProxySettings: () => ({ proxy: '', noProxy: [] }),
    ...overrides,
  })
}
