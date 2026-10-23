// The developer-options failure, alone in this module: the process shim
// reads the machine id (and so this error) without carrying the profile
// schemas behind DeveloperOptions.
import { UI_TEXT } from '../../shared/constants'

export class DeveloperOptionsError extends Error {
  public constructor(
    public readonly code: 'locked' | 'unavailable' | 'invalidRequest' | 'differentMachine',
    options?: { cause?: unknown },
  ) {
    super(UI_TEXT.developer[code], options)
    this.name = 'DeveloperOptionsError'
  }
}
