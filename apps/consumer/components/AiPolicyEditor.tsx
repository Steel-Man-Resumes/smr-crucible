'use client';
import { useEffect, useState } from 'react';
import { AI_WORKFLOWS, type AiWorkflow, type ToolPolicy } from '@/lib/ai-operation-policy';
const empty = (workflow: AiWorkflow): ToolPolicy => ({workflow,disabled:false,daily_calls:null,daily_usd:null,reserve_usd:null,premium_tool:null});
export function AiPolicyEditor() {
  const [policies,setPolicies]=useState<ToolPolicy[]>([]);
  const [draft,setDraft]=useState<ToolPolicy>(empty('assistant'));
  const [message,setMessage]=useState('');
  const [ready,setReady]=useState(false);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/admin/ai-policy',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();})
      .then(d=>{setPolicies(d.policies);setDraft(d.policies.find((p:ToolPolicy)=>p.workflow==='assistant') || empty('assistant'));setReady(true);})
      .catch(()=>{if(!controller.signal.aborted)setMessage('Could not load controls.');});
    return ()=>controller.abort();
  },[]);
  async function save() {
    if(!window.confirm(`Apply these access controls to ${draft.workflow}?`))return;
    setSaving(true);setMessage('');
    try {
      const response=await fetch('/api/admin/ai-policy',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
      const data=await response.json();if(!response.ok)throw new Error(data.error || 'Not saved.');
      setPolicies(previous=>[...previous.filter(p=>p.workflow!==draft.workflow),data.policy]);setMessage('Controls saved.');
    } catch(error){setMessage(error instanceof Error?error.message:'Not saved.');}
    finally{setSaving(false);}
  }
  return <details className="border border-t-line p-3"><summary className="cursor-pointer text-sm text-t-white">Tool controls</summary>
    <p className="text-xs text-t-phos-dim my-2">Blank limits add no new allowance. Existing quotas and sponsorship still apply. A reservation is a planning amount; provider charges can exceed it. This never changes prices.</p>
    <fieldset disabled={!ready || saving} className="grid gap-3 sm:grid-cols-2 text-xs text-t-phos">
      <label>Workflow<select className="block w-full bg-t-panel border border-t-line p-2" value={draft.workflow} onChange={e=>{const workflow=e.target.value as AiWorkflow;setDraft(policies.find(p=>p.workflow===workflow)||empty(workflow));setMessage('');}}>{AI_WORKFLOWS.map(w=><option key={w}>{w}</option>)}</select></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.disabled} onChange={e=>setDraft({...draft,disabled:e.target.checked})}/>Pause new operations</label>
      {(['daily_calls','daily_usd','reserve_usd'] as const).map(key=><label key={key}>{({daily_calls:'Operations per user per UTC day',daily_usd:'Recorded USD plus reservations per user per day',reserve_usd:'USD reserved for each operation'})[key]}
        <input className="block w-full bg-t-panel border border-t-line p-2" type="number" min="0" step={key==='daily_calls'?'1':'0.000001'} value={draft[key] ?? ''} onChange={e=>setDraft({...draft,[key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}
      <label>Additional sponsorship check<select className="block w-full bg-t-panel border border-t-line p-2" value={draft.premium_tool ?? ''} onChange={e=>setDraft({...draft,premium_tool:(e.target.value || null) as ToolPolicy['premium_tool']})}><option value="">No additional requirement</option><option value="interview_coaching">Interview coaching</option><option value="one_click_apply">One-click apply</option></select></label>
      <button type="button" className="t-focus border border-t-line p-2" onClick={save}>{saving?'Saving...':'Review and apply controls'}</button>
    </fieldset><p role="status" className="text-xs text-t-phos-dim mt-2">{message}</p>
  </details>;
}
