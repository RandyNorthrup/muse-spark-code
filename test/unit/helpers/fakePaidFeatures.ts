/** Default host/manager fixture: no paid feature or child-task consent is granted. */
export const disabledPaidFeatures = {
  isPaidFeatureOn: () => false,
  notePaidUse: () => undefined,
  confirmSubagentTask: () => Promise.resolve(false),
  noteSubagentUsage: () => undefined,
}
