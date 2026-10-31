// Removes every entry a keyring suite's throwaway service still holds, so
// a case that failed mid-drive leaves nothing in the person's real store
// (the suites run on Windows in hosted CI, like keyringParts).
import { AsyncEntry, findCredentialsAsync } from '@napi-rs/keyring'

export async function deleteAllServiceEntries(service: string): Promise<void> {
  const remaining = await findCredentialsAsync(service)
  for (const entry of remaining) {
    await new AsyncEntry(service, entry.account).deletePassword()
  }
}
