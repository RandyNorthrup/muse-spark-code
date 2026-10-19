import { describeSourceGuard } from './helpers/guardProcess'

describeSourceGuard({
  title: 'wrap-up single-builder guard',
  scriptName: 'check-wrap-up-request.mjs',
  sourceRel: 'src/core/backends/modelapi/ModelApiHost.ts',
  tag: 'wrap-up-guard',
  plantSnippet: '\n// planted second builder\nturn.wrapUpLimit = 0\n',
  plantMessage: 'expected exactly one wrapUpLimit write, found 2',
  passMessage: 'single builder ok',
})
