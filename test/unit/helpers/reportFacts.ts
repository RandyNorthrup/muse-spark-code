// Allowlisted support facts for the problem report's tests (M93): one fixture
// the builder's, the handler's and the export's suites share.

import type { ProblemReportFacts } from '../../../src/core/support/problemReport'

export const REPORT_FACTS: ProblemReportFacts = {
  extensionVersion: '0.12.1',
  vscodeVersion: '1.99.0',
  nodeVersion: '22.20.4',
  platform: 'linux',
  backend: 'auto',
  sandbox: 'auto',
  cliFound: true,
  cliVersion: '1.4.2',
  cliSignIn: true,
  hasStoredApiKey: false,
  hasEnvironmentApiKey: false,
  settingNames: ['museSpark.backend', 'museSpark.shellSandbox'],
}
