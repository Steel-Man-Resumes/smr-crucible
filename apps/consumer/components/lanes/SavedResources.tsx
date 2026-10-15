"use client";
import {useEffect,useState} from 'react';
import type {PublishedResource,PublishedResourceStep} from '@crucible/core';
type SavedList={id:string;created_at:string};
type Reopened={status:string;services:{id:string;status:string;data:PublishedResource|null}[];chains:{key:string;status:string;data:PublishedResourceStep[]}[]};
const safeLink=(url:string|null)=>url && /^https?:\/\//i.test(url)?url:null;
export function SavedResources({refresh=0}:{refresh?:number}){
 const [lists,setLists]=useState<SavedList[]>([]),[opened,setOpened]=useState<Reopened|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;fetch('/api/artifacts?type=resource_list&limit=20',{cache:'no-store'}).then(async res=>{
  if(!res.ok)throw new Error('Saved choices could not be read.');const body=await res.json();if(live)setLists(Array.isArray(body.data)?body.data:[]);
 }).catch(()=>{if(live)setError('Saved choices could not be read. Refresh to try again.');});return()=>{live=false;};},[refresh]);
 async function open(id:string){setBusy(true);setError('');setOpened(null);try{
  const res=await fetch(`/api/resource-lists/${id}`,{cache:'no-store'}),body=await res.json();
  if(!res.ok)throw new Error(body.error||'Current listings could not be checked. Try again.');setOpened(body);
 }catch(e){setError(e instanceof Error?e.message:'Could not reopen your choices.');}finally{setBusy(false);}}
 return <div className="mt-4">
  {error && <p role="status" className="text-sm text-t-amber">{error}</p>}
  {lists.length>0 && <details><summary className="cursor-pointer text-t-steel">Your saved support choices</summary>
   <p className="my-2 text-sm text-t-phos-dim">Open a list to check the latest details. Saving a choice does not arrange a service.</p>
   <ul>{lists.map((list,index)=><li key={list.id}><button type="button" disabled={busy} className="min-h-touch text-t-steel underline" onClick={()=>void open(list.id)}>Choices saved {new Date(list.created_at).toLocaleDateString()} ({index+1})</button></li>)}</ul>
  </details>}
  {opened?.status==='invalid' && <p role="status">This older list needs a new search before it can be used.</p>}
  {opened && <div className="mt-3 space-y-3">{opened.services.map(item=><div key={item.id} className="border border-t-line p-3">
   {item.data?<><p className="font-semibold">{item.data.service_name||item.data.org_name}</p><p className="text-sm">{item.data.description}</p>
    <p className="text-sm">{item.status==='changed'?'Details changed since you saved this. ':''}Checked {item.data.last_checked}; review due {item.data.expires_on}.</p>
    {[item.data.eligibility,item.data.fees,item.data.what_to_bring,item.data.limits].filter(Boolean).map((text,index)=><p className="text-sm" key={index}>{text}</p>)}
    {item.data.phone && <p className="text-sm">Call {item.data.phone}</p>}
    {safeLink(item.data.source_url) && <a className="text-t-steel underline" href={item.data.source_url} target="_blank" rel="noopener noreferrer">Current source</a>}
   </>:<p>This service is no longer in the checked listings. Search again for current help.</p>}
  </div>)}{opened.chains.map(chain=><div key={chain.key} className="border border-t-line p-3">
   {!chain.data.length?<p>This step list is no longer current. Search again before using it.</p>:<><p className="font-semibold">{chain.data[0].goal}</p>{chain.status==='changed'&&<p>Steps changed since you saved this.</p>}<ol className="list-decimal pl-5">{chain.data.map(step=><li key={step.n}>{step.action}{step.where_how&&<p>{step.where_how}</p>}{step.requires.length>0&&<p>Bring or complete: {step.requires.join(', ')}</p>}{safeLink(step.source_url)&&<a className="text-t-steel underline" href={step.source_url} target="_blank" rel="noopener noreferrer">Source</a>}</li>)}</ol></>}
  </div>)}</div>}
 </div>;
}
