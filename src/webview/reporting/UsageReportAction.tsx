import { UI_TEXT } from '../../shared/constants'

/** Mounted by W inside Account & usage through the reporting lazy boundary. */
export default function UsageReportAction({
  onUsageReport,
}: {
  readonly onUsageReport: () => void
}) {
  return (
    <button type="button" className="button-secondary" onClick={onUsageReport}>
      {UI_TEXT.reportUsageAction}
    </button>
  )
}
