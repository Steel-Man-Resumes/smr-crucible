import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchRoles, jobRelevance } from '../job-search-relevance';
test('vague searches use saved direction with at most two distinct searches', () => {
  assert.deepEqual(searchRoles('jobs', 'Production supervisor', ['inventory']), ['Production supervisor', 'Production associate']);
  assert.deepEqual(searchRoles('anything', '', ['warehouse inventory']), ['Material handler']);
  assert.deepEqual(searchRoles('', '', []), []);
});
test('explicit role wins over another career direction', () => {
  assert.equal(searchRoles('Cook', 'Production supervisor', ['inventory'])[0], 'Cook');
});
test('actual title overlap outranks unrelated specialist posts with generic skills', () => {
  const roles = ['Production supervisor', 'Production associate'];
  const relevant = jobRelevance({title:'Production Line Supervisor', full_description:'Manage the shift and inventory'}, roles, ['inventory management']);
  const irrelevant = jobRelevance({title:'Physician Diagnostic Radiologist', full_description:'Practice management and inventory responsibilities'}, roles, ['inventory management']);
  assert.ok(relevant.score > irrelevant.score);
  assert.match(relevant.reason, /Check the requirements/);
});
