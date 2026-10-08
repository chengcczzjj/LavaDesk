/**
 * One reading of tool results for the chat service and every chat surface.
 * Older tools report `success`, newer ones `ok`; approvals and user-declined
 * confirmations are neither successes nor failures.
 */

export interface ActionReceipt {
  /** Journal entry id; pass it to the undo channel/tool. */
  id: string
  /** Short user-facing description of what changed, e.g. "添加了天气组件". */
  summary: string
  undoable: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function isApprovalToolOutput(output: unknown): boolean {
  const record = asRecord(output)
  if (!record) return false
  return record.approvalRequired === true || Boolean(asRecord(record.approval))
}

/** The user said no (or did not answer) to a confirmation card. */
export function isDeclinedToolOutput(output: unknown): boolean {
  return asRecord(output)?.declined === true
}

export function isFailedToolOutput(output: unknown, error?: unknown): boolean {
  if (error) return true
  const record = asRecord(output)
  if (!record) return false
  if (isApprovalToolOutput(output) || isDeclinedToolOutput(output)) return false
  return record.ok === false || record.success === false
}

export function readActionReceipt(output: unknown): ActionReceipt | null {
  const receipt = asRecord(asRecord(output)?.receipt)
  if (!receipt || typeof receipt.id !== 'string' || typeof receipt.summary !== 'string') return null
  return { id: receipt.id, summary: receipt.summary, undoable: receipt.undoable === true }
}
