import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationRead,publishedEmployerSql,isPublicationId,isChainKey,DIRECTORY_CONTRACT_VERSION,RESOURCE_FIELDS} from '../directoryPublication';
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
test('resource contract 2026-10-18.v3 publishes bands over the 088 tier fields (migration 089)',()=>{
 assert.equal(DIRECTORY_CONTRACT_VERSION,'2026-10-18.v3');
 const fields=RESOURCE_FIELDS.split(',').map(f=>f.trim().replace(/^.*AS /,''));
 for(const f of ['verification_tier','tier_confidence','corroboration_points','version','band','band_reason'])assert.ok(fields.includes(f),f);
});

import {resourceBandSql,resourceAppSql,parseBands,RESOURCE_BAND_LABELS} from '../resourceDirectoryShared';
test('public bands default to A, keep place and bands as parameters, and cap each band and level on its own',()=>{
 assert.deepEqual(parseBands(undefined),['A']);assert.deepEqual(parseBands('abc'),['A','B','C']);assert.deepEqual(parseBands('C,A'),['A','C']);assert.deepEqual(parseBands("x'; DROP"),['A']);
 const {sql,params}=resourceBandSql({state:'MT',areas:['food'],countyKeys:['lincoln'],cityKey:'libby',zip:'59923',bands:['A','B','C']});
 assert.match(sql,/FROM resource_band_publication_v/);assert.match(sql,/band = ANY\(\$6::text\[\]\)/);assert.match(sql,/WHERE r\.rn <= \$7/);
 assert.match(sql,/PARTITION BY m\.band, m\.lvl/);assert.match(sql,/ORDER BY r\.band, r\.lvl, r\.last_checked DESC/);
 assert.doesNotMatch(sql,/'MT'|'food'|lincoln|libby|DROP/);assert.deepEqual(params,[['food'],'MT',['lincoln'],'libby','59923',['A','B','C'],50]);
 const whole=resourceBandSql({state:'MT',areas:['food'],wholeState:true});assert.match(whole.sql,/\(geo_scope = 'national' OR state = \$2\)/);
 // The app read (resource_app_v) is unchanged by the refactor: same text shape and parameter order.
 const app=resourceAppSql({state:'MT',areas:['food'],countyKeys:['lincoln'],cityKey:'libby',zip:'59923'});
 assert.match(app.sql,/FROM resource_app_v/);assert.deepEqual(app.params,[['food'],'MT',['lincoln'],'libby','59923',50]);assert.doesNotMatch(app.sql,/band/);
 assert.equal(RESOURCE_BAND_LABELS.C,'Found, could not confirm. Call first.');
});
