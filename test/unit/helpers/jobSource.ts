// The shipped C# of the Windows job helpers (PLAN.md D6), as the tests hand
// it to the helpers: read from the repository through the production reader,
// where the extension reads it from its own folder.
import { jobSourceReader } from '../../../src/host/backend/jobSource'

export const readJobSource = jobSourceReader(process.cwd())
