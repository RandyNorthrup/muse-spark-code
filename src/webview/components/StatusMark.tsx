// The working line's mark (M87, D66): six small circles looping Inclushe's
// "circle pattern animation lighten" (CodePen OPWreWR, MIT), written fresh
// with no pointer tracking. Decorative, like the heartbeat trace beside it.
export function StatusMark() {
  return (
    <span className="status-mark" aria-hidden="true">
      <span className="status-mark-circle" />
      <span className="status-mark-circle" />
      <span className="status-mark-circle" />
      <span className="status-mark-circle" />
      <span className="status-mark-circle" />
      <span className="status-mark-circle" />
    </span>
  )
}
