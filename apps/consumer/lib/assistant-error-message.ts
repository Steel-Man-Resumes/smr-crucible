/** Keep provider/internal errors private while explaining known access failures. */
export function assistantErrorMessage(message: string): string {
  let code = '';
  try { code = JSON.parse(message)?.code || ''; } catch { /* Stream/provider failures are intentionally generic. */ }
  if (code === 'tool_policy_unavailable' || message.includes('Chat access could not be checked')) return 'I couldn’t check your chat access. Your saved work is safe. Try again shortly; if this continues, report a coach access error.';
  if (code === 'tool_allowance_used' || message.includes('429') || message.includes('daily chat allowance')) return 'Your current AI allowance is used. You can request more through the progress bar or return after the daily reset. Your saved work is still available.';
  return 'The coach couldn’t finish this reply. Your saved work is still available. Try again in a moment.';
}
