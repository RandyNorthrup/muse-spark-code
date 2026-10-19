import { isEstimateCommandText } from './commandPrefix'

/** Every webview host receives the same command, parsed by its lazy runtime. */
export function wasEstimateComposerHandled(
  text: string,
  port: { submit(text: string): void },
): boolean {
  if (!isEstimateCommandText(text.trim())) return false
  port.submit(text)
  return true
}
