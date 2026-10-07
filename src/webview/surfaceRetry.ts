const documentRetry = {
  run: () => {
    window.location.reload()
  },
}

/** Use the shell's document rebuild after flushing the existing persisted state. */
export function installSurfaceRetry(save: () => void, rebuild: () => void): void {
  documentRetry.run = () => {
    save()
    rebuild()
  }
}

/** A fresh document clears failed static dependencies as well as entry imports. */
export function retrySurface(): void {
  documentRetry.run()
}
