import {getResourceCoverageSummary} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
/** Services per state per band. Counts only: the "Who helps here" ledger on the public map. */
export async function GET(request:Request){const denied=await directoryReadLimit(request);if(denied)return denied;return directoryResponse(await getResourceCoverageSummary());}
