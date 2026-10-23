/** Poll until the assertion holds, then fail loud with the last message. */
export async function waitForTui(
  description: string,
  check: () => void,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() > deadline)
        throw new Error(
          `${description}: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
          },
        )
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
