import type { MuseCodeLifecycleEvent, MuseCodeLifecycleReader } from './mapNotification'
import { sessionListChangedSchema } from './sessionRecords'

const SESSION_STARTED = 'session/started'
const SESSION_DELETE_COMPLETED = 'session/deleteCompleted'

/**
A `session/deleteCompleted` notice arrived, and no served capture of that
frame exists: `session/delete` is refused -32601 methodNotFound on 1.4.4
and later (test/fixtures/acphonest/session-delete-1.4.11.json), and the
m106 captures carry no deleteCompleted frame either. The reader refuses by
name rather than guess at the shape; the dispatch that catches this logs
the name.
*/
export class LifecycleDeleteUnreadableError extends Error {
  constructor() {
    super(`${SESSION_DELETE_COMPLETED} has no captured shape`)
    this.name = 'LifecycleDeleteUnreadableError'
  }
}

/**
Parse one lifecycle notice from its recorded frames. `session/started`
carries the same `{ session }` envelope as `session/listChanged`
(test/fixtures/m127/note-session-started-1.4.9.json,
test/fixtures/acphonest/note-session-started-1.4.11.json), so the shared
record schema reads it. The delete terminal has no served capture and
refuses by name instead.
*/
export function parseLifecycleNotification(notification: {
  readonly method: string
  readonly params: unknown
}): MuseCodeLifecycleEvent {
  if (notification.method === SESSION_STARTED) {
    return {
      type: 'started',
      record: sessionListChangedSchema.parse(notification.params).session,
    }
  }
  throw new LifecycleDeleteUnreadableError()
}

/**
The captured-frame lifecycle reader both hosts bind
(`NATIVE_MUSE_CODE_FEATURE_PORTS`): `session/started` is served and read,
so externally started sessions reach the session list. The delete half
stays absent — no delete admission receipt or terminal was ever captured
from a served CLI — so `deleteSession` keeps refusing with
`sessionDeleteUnsupported` without sending, and History offers no Delete.
*/
export const NATIVE_LIFECYCLE_READER: MuseCodeLifecycleReader = {
  parseNotification: parseLifecycleNotification,
}

/**
True when the reader parses delete admissions: the delete frames have no
served capture, so the native started-only reader answers false and
`deleteSession` refuses without sending.
*/
export function isDeleteCapableReader(
  reader: MuseCodeLifecycleReader | undefined,
): reader is MuseCodeLifecycleReader &
  Required<Pick<MuseCodeLifecycleReader, 'parseDeleteAdmission'>> {
  return reader?.parseDeleteAdmission !== undefined
}
