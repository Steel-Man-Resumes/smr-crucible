import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/org-guard';
import { getAiCostReport } from '@/lib/ai-cost-report';
export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const days = parseInt(new URL(request.url).searchParams.get('days') || '30', 10);
  try { return NextResponse.json(await getAiCostReport(guard.userId, days)); }
  catch { return NextResponse.json({ error: 'Cost accounting could not be read. Check migration readiness.' }, { status: 503 }); }
}
