"use client";
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
/** Display the actual PDF bytes served by the download route for this saved revision. */
export function SavedPackagePreview({revisionId,applicationId}:{revisionId:string;applicationId?:string|null}){
 const t=useTranslations("refineryResume.savedPreview");
 const [url,setUrl]=useState(''),[failed,setFailed]=useState(false);
 useEffect(()=>{const controller=new AbortController();let objectUrl='';setUrl('');setFailed(false);fetch(applicationId?`/api/applications/package-preview?applicationId=${encodeURIComponent(applicationId)}&revisionId=${encodeURIComponent(revisionId)}`:'/api/forge/download',applicationId?{signal:controller.signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revisionId,type:'resume',format:'pdf'}),signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('preview');const blob=await r.blob();if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};},[revisionId,applicationId]);
 return <section className="my-5 border border-t-line p-4"><h2 className="font-bold text-t-white">{t("title")}</h2><p className="mt-1 text-sm text-t-phos-dim">{t("body")}</p>{failed?<p role="status" className="mt-3 text-sm text-t-phos">{t("failed")}</p>:url?<><a href={url} target="_blank" rel="noopener noreferrer" className="t-focus my-2 inline-flex min-h-touch items-center text-purple-300 underline">{t("open")}</a><iframe title={t("iframeTitle")} src={url} className="h-[640px] w-full bg-white"/></>:<p role="status">{t("preparing")}</p>}</section>;
}
