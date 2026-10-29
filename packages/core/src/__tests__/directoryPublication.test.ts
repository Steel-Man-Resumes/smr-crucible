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
 assert.match(x.sql,/LIMIT \$4 OFFSET \$5/);assert.ok(!x.sql.includes('OR true'));assert.deepEqual(x.params[0],['A']);assert.equal(x.params[1],"%100\\% \\_ ' OR true%");assert.equal(x.params.at(-1),0);
 assert.equal(publishedEmployerSql({page:99999}).params.at(-1),975);
 // 090: employers read from the band view, A only unless asked; B never changes the mark.
 assert.match(x.sql,/FROM employer_band_publication_v/);assert.match(x.sql,/band=ANY\(\$1::text\[\]\)/);assert.match(x.sql,/ORDER BY band,state,name,id/);
 assert.deepEqual(publishedEmployerSql({bands:['A','B']}).params[0],['A','B']);
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
test('contract 2026-10-18.v4 publishes resource bands (089) and employer bands (090)',()=>{
 assert.equal(DIRECTORY_CONTRACT_VERSION,'2026-10-18.v4');
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
 const whole=resourceBandSql({state:'MT',areas:['food'],wholeState:true,bands:['A','B','C']});assert.match(whole.sql,/\(geo_scope = 'national' OR state = \$2\)/);
 // Every bound parameter is referenced (an unused one has no type and Postgres refuses the query: live 2026-10-18).
 assert.deepEqual(whole.params,[['food'],'MT',['A','B','C'],50]);assert.match(whole.sql,/band = ANY\(\$3::text\[\]\)/);assert.match(whole.sql,/r\.rn <= \$4/);
 for(const x of [whole,resourceBandSql({state:null,areas:['food']})]){const used=new Set((x.sql.match(/\$\d+/g)||[]).map(m=>Number(m.slice(1))));for(let i=1;i<=x.params.length;i++)assert.ok(used.has(i),`$${i} bound but unused`);}
 // Paged state read (2026-10-24): walks the whole list, no per-level cap, same order; unchanged without page.
 const pg=resourceBandSql({state:'MI',areas:['food'],wholeState:true,bands:['A','B','C'],page:3,pageSize:200});
 assert.doesNotMatch(pg.sql,/row_number|rn <=/);assert.match(pg.sql,/LIMIT \$4 OFFSET \$5/);assert.deepEqual(pg.params,[['food'],'MI',['A','B','C'],200,400]);
 assert.match(pg.sql,/ORDER BY band,\s+CASE geo_scope[\s\S]*last_checked DESC, org_name, service_id/);
 const used=new Set((pg.sql.match(/\$\d+/g)||[]).map(m=>Number(m.slice(1))));for(let i=1;i<=pg.params.length;i++)assert.ok(used.has(i),`$${i} bound but unused`);
 assert.equal(resourceBandSql({state:'MI',areas:['food'],wholeState:true,bands:['A'],page:1,pageSize:9999}).params.at(-2),200);
 for(const bad of [{page:0},{page:-1},{page:1.5},{page:NaN},{page:61},{page:null},{}])assert.match(resourceBandSql({state:'MI',areas:['food'],wholeState:true,bands:['A'],...bad}).sql,/PARTITION BY m\.band/,'unpaged keeps the cap: '+JSON.stringify(bad));
 assert.match(resourceBandSql({state:'MI',areas:['food'],countyKeys:['kent'],bands:['A'],page:1}).sql,/PARTITION BY m\.band/);
 // The app read (resource_app_v) is unchanged by the refactor: same text shape and parameter order.
 const app=resourceAppSql({state:'MT',areas:['food'],countyKeys:['lincoln'],cityKey:'libby',zip:'59923'});
 assert.match(app.sql,/FROM resource_app_v/);assert.deepEqual(app.params,[['food'],'MT',['lincoln'],'libby','59923',50]);assert.doesNotMatch(app.sql,/band/);
 assert.equal(RESOURCE_BAND_LABELS.C,'Found, could not confirm. Call first.');
});

test('employer search: a typed city ranks first inside the query, before the limit, and never filters (demo-eve E2)',()=>{
 const x=publishedEmployerSql({state:'MI',bands:['A','B'],limit:25,city:'Lansing'});
 assert.match(x.sql,/ORDER BY CASE WHEN lower\(regexp_replace\(coalesce\(city,''\),'\[\^A-Za-z\]','','g'\)\)=\$3 THEN 0 ELSE 1 END,band,state,name,id LIMIT \$4 OFFSET \$5/);
 assert.equal(x.params[2],'lansing');assert.equal(x.params[3],25);
 assert.ok(!/WHERE[^]*city[^]*ORDER BY/.test(x.sql.replace(/concat_ws\([^)]*\)/,'')),'the city is not a WHERE filter');
 assert.equal(publishedEmployerSql({city:"Grand Rapids'; DROP"}).params.includes('grandrapidsdrop'),true,'letters only, always a bound parameter');
 assert.match(publishedEmployerSql({state:'MI'}).sql,/ORDER BY band,state,name,id/,'no city: same order as before');
 assert.match(publishedEmployerSql({state:'MI',city:'  '}).sql,/ORDER BY band,state,name,id/);
});
