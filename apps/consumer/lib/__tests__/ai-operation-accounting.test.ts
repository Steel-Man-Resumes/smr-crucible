import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeCostUsd, measureCost } from '../ai-usage-log';
import { parseToolPolicy, isAiWorkflow } from '../ai-operation-policy';
import { withAiOperation, currentAiOperation, trackUsageWrite } from '../ai-operation-context';

test('unknown and future models stay unpriced, date snapshots match precisely',()=>{
 assert.equal(measureCost('gpt-4o',{inputTokens:NaN,outputTokens:0}).status,'unpriced');
 assert.equal(measureCost('new-model',{inputTokens:100,outputTokens:50}).costUsd,null);
 assert.equal(measureCost('gpt-4o-mini-next',{inputTokens:100,outputTokens:50}).status,'unpriced');
 assert.equal(computeCostUsd('gpt-4o-mini-2024-07-18',{inputTokens:1_000_000,outputTokens:0}),.15);
 assert.throws(()=>computeCostUsd('unknown',{inputTokens:1,outputTokens:0}),/AI_PRICE_UNAVAILABLE/);
});
test('cache reads use the model-specific verified rate',()=>{
 assert.equal(computeCostUsd('claude-sonnet-5-5',{inputTokens:0,outputTokens:0,cacheReadInputTokens:1_000_000}),.1);
 assert.equal(computeCostUsd('claude-sonnet-5',{inputTokens:1_000_000,outputTokens:0}),2);
});
test('elapsed voice has a labeled estimate, never exact billing',()=>{
 const price=measureCost('gpt-realtime-2',{inputTokens:0,outputTokens:0,audioSeconds:60});
 assert.equal(price.status,'estimated');assert.ok(price.costUsd!>0);assert.match(price.basis,/estimate/);
 assert.equal(measureCost('future-voice',{inputTokens:0,outputTokens:0,audioSeconds:60}).status,'unpriced');
});
test('policy cannot gate export or omit a reservation for a spend allowance',()=>{
 const valid={workflow:'assistant',disabled:false,daily_calls:null,daily_usd:null,reserve_usd:null,premium_tool:null};
 assert.ok(parseToolPolicy(valid));assert.equal(parseToolPolicy({...valid,daily_usd:1}),null);
 assert.equal(parseToolPolicy({...valid,daily_calls:-1}),null);
 assert.equal(parseToolPolicy({...valid,daily_calls:1.5}),null);
 assert.equal(parseToolPolicy({...valid,workflow:'forge-download'}),null);
 assert.equal(isAiWorkflow('delete-data'),false);
});
test('parallel workflow accounting is isolated and pending writes remain attached',async()=>{
 const a={operationId:'a',userId:'one',endpoint:'coach',pending:[] as Promise<unknown>[]};
 const b={operationId:'b',userId:'two',endpoint:'coach',pending:[] as Promise<unknown>[]};
 await Promise.all([a,b].map(c=>withAiOperation(c,async()=>{await Promise.resolve();assert.equal(currentAiOperation()?.userId,c.userId);trackUsageWrite(Promise.resolve());})));
 assert.equal(a.pending.length,1);assert.equal(b.pending.length,1);assert.equal(currentAiOperation(),undefined);
});
