/** Default host/manager fixture: no paid feature is on, and the paid-use popup denies. */
export const disabledPaidFeatures = {
  isPaidFeatureOn: () => false,
  notePaidUse: () => undefined,
  allowsPaidUse: () => Promise.resolve(false),
  isPaidUseRemembered: () => false,
  noteSubagentUsage: () => undefined,
  noteReviewerUsage: () => undefined,
}
