"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
export function LineReview({text}:{text:string}){
 const t=useTranslations("refineryResume.lineReview");
 const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
 const [index,setIndex]=useState(0),[answers,setAnswers]=useState<Record<number,string>>({});
 const current=Math.min(index,Math.max(0,lines.length-1));
 const answer=answers[current]||'';
 if(!lines.length)return null;
 return <section className="mb-5 border border-purple-400/40 bg-t-panel p-4"><p className="font-mono text-xs text-purple-300">{t("kicker")}</p><h2 className="mt-2 text-lg font-bold text-t-white">{t("title")}</h2><p className="mt-2 text-sm text-t-phos">{t("intro")}</p><details className="mt-3"><summary className="t-focus min-h-touch cursor-pointer text-purple-300 underline">{t("start")}</summary><p className="mt-3 font-mono text-xs text-t-phos-dim">{t("lineOf",{current:current+1,total:lines.length})}</p><blockquote className="my-3 border-l-2 border-purple-400 pl-3 text-t-white">{lines[current]}</blockquote><label className="block text-sm text-t-phos" htmlFor="line-explanation">{t("label")}</label><textarea id="line-explanation" value={answer} onChange={e=>setAnswers(previous=>({...previous,[current]:e.target.value}))} maxLength={2000} className="mt-2 min-h-24 w-full border border-t-line bg-t-bg p-3 text-t-white"/><div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('troy-line-help',{detail:{text:`Help me understand and strengthen this resume line, one question at a time. Do not invent an example for me. Line: ${lines[current]}\nMy explanation: ${answer||'I need help getting started.'}`}}))} className="t-focus min-h-touch bg-purple-700 px-4 text-white">{t("workWith")}</button><button type="button" disabled={current===0} onClick={()=>{setIndex(current-1);}} className="t-focus min-h-touch px-3 text-t-phos disabled:opacity-40">{t("previous")}</button><button type="button" disabled={current===lines.length-1} onClick={()=>{setIndex(current+1);}} className="t-focus min-h-touch px-3 text-t-phos disabled:opacity-40">{t("next")}</button></div><p className="mt-3 text-xs text-t-phos-dim">{t("note")}</p><Link href="/dashboard/master" className="t-focus mt-2 inline-flex min-h-touch items-center text-sm text-purple-300 underline">{t("saveMaster")}</Link></details></section>;
}
