import { z } from 'zod';
export const ResourceListContent = z.object({
 schemaVersion:z.literal(1),
 services:z.array(z.object({id:z.uuid(),version:z.string().regex(/^[a-f0-9]{32}$/)}).strict()).max(20),
 chains:z.array(z.object({key:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/),versions:z.array(z.string().regex(/^[a-f0-9]{32}$/)).min(1).max(50)}).strict()).max(5),
}).strict().refine(x=>x.services.length+x.chains.length>0,'Choose a resource or a step list.');
export type ResourceListContent = z.infer<typeof ResourceListContent>;
export const ResourceListSelection = z.object({serviceIds:z.array(z.uuid()).max(20),chainKeys:z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/)).max(5).default([])}).strict().refine(x=>x.serviceIds.length+x.chainKeys.length>0,'Choose a resource or a step list.');
