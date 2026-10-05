import type { ConversationController } from './conversationController'

/**
 * The extension's existing restart sequence (D25/D26), shared with its tests
 * so a Muse-only recovery proves both controller and host isolation.
 */
export async function restartConversationBackends(
  controllers: Iterable<ConversationController>,
  museCode: { dispose: () => Promise<void> },
  modelApi: { dispose: () => Promise<void> },
  isConversationEnding: boolean,
  isMuseCodeOnly: boolean,
): Promise<void> {
  await Promise.all(
    Array.from(controllers, (controller) =>
      controller.backendStopping(isConversationEnding, isMuseCodeOnly ? 'museCode' : undefined),
    ),
  )
  await Promise.all([museCode.dispose(), ...(isMuseCodeOnly ? [] : [modelApi.dispose()])])
}
