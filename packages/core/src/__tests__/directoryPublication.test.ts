import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationRead,publishedEmployerSql,isPublicationId,isChainKey} from '../directoryPublication';
import {ResourceListContent,ResourceListSelection} from '../resourceListShared';
test('publication outages never masquerade as an empty area',async()=>{
 const empty=await publicationRead([],async()=>[]);
 const failed=await publicationRead([],async()=>{throw new Error('private database details');});
 assert.equal(empty.status,'ok');assert.equal(failed.status,'unavailable');assert.ok(!JSON.stringify(failed).includes('private database'));assert.equal(failed.contractVersion,empty.contractVersion);
});
test('employer search is bounded, parameterized and matches literal search punctuation',()=>{
 const x=publishedEmployerSql({q:"100% _ ' OR true",page:Infinity,state:'WI'});
 assert.match(x.sql,/LIMIT \$3 OFFSET \$4/);assert.ok(!x.sql.includes('OR true'));assert.equal(x.params[0],"%100\\% \\_ ' OR true%");assert.equal(x.params.at(-1),0);
 assert.equal(publishedEmployerSql({page:99999}).params.at(-1),975);
});
test('resource saved content cannot smuggle private notes or unsupported service claims',()=>{
 const id='10000000-0000-4000-8000-000000000001',version='a'.repeat(32);
 assert.equal(ResourceListContent.safeParse({schemaVersion:1,services:[{id,version}],chains:[]}).success,true);
 for(const extra of [{received:true},{privateNotes:'a story'},{eligibility:'guaranteed'}])assert.equal(ResourceListContent.safeParse({schemaVersion:1,services:[{id,version,...extra}],chains:[]}).success,false);
 assert.equal(ResourceListContent.safeParse({schemaVersion:1,services:[],chains:[],context:{resume:'private'}}).success,false);
 assert.equal(ResourceListSelection.safeParse({serviceIds:Array(21).fill(id)}).success,false);
 assert.equal(ResourceListSelection.safeParse({serviceIds:[]}).success,false);
});
test('canonical detail and chain identifiers reject display-name guessing and path input',()=>{
 assert.equal(isPublicationId('Example Company'),false);assert.equal(isPublicationId('10000000-0000-4000-8000-000000000001'),true);
 assert.equal(isChainKey('../../private'),false);assert.equal(isChainKey('WI-ID-steps'),true);
});
