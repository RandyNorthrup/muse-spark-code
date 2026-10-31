/** A vault with nothing in it: every read answers undefined and every write is accepted. */
export function emptyVault() {
  return {
    read: () => Promise.resolve(undefined),
    readForRemoval: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  }
}

/** The settings snapshot the accounts panel reads, with only the several-accounts switch varying. */
export function accountSettings(isSeveralOn: boolean) {
  return { isSwapOn: false, isParallelOn: false, severalOnThisDevice: isSeveralOn }
}
