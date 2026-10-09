import type { AcpAgentDeps } from '../../../src/acp/agent'

// Translation/permission unit suites isolate their view with this engine fake.
// Production and stdio suites use the real composed ConversationController.
export const fakeAcpComposition: AcpAgentDeps['createConversation'] = (session) =>
  Promise.resolve({
    controller: undefined,
    submit: (parts, text) => session.sendTurn(parts, text),
    permissionModeChanged() {
      /* This fixture observes mode through its fake session. */
    },
    hostExited() {
      /* The view fixture owns its scripted terminal outcome. */
    },
    release() {
      session.dispose()
      return Promise.resolve()
    },
  })
