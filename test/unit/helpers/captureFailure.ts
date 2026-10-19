/** Run a production call that must fail, and hand back what it threw. */
export async function captureFailure(run: () => unknown): Promise<unknown> {
  try {
    await run()
  } catch (error: unknown) {
    return error
  }
  throw new Error('the production call succeeded instead of failing')
}
