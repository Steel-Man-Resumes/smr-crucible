import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantErrorMessage } from '../assistant-error-message';
test('access-check failures are distinct from exhausted allowance', () => {
  assert.match(assistantErrorMessage(JSON.stringify({code:'tool_policy_unavailable'})), /check your chat access/);
  assert.match(assistantErrorMessage(JSON.stringify({code:'tool_allowance_used'})), /progress bar/);
});
test('internal/provider error text never reaches the displayed explanation', () => {
  const text=assistantErrorMessage('provider secret internal trace');
  assert.doesNotMatch(text, /secret|internal trace/);
  assert.match(text, /saved work/);
});
