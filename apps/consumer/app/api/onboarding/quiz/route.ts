import { NextResponse } from 'next/server';
import { effectiveAuth as auth } from '@/lib/effective-auth';
import { isSameOriginJsonPost } from '@/lib/same-origin';
import { gradeOrientation } from '@/lib/orientation-grade';
import { grantOrientation, orientationStatus } from '@/lib/orientation-server';

export const revalidate = 0;
export const maxDuration = 15;
const headers = { 'Cache-Control': 'no-store' };
export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Sign in to see your orientation result.' }, { status: 401, headers });
  try { return NextResponse.json({ data: await orientationStatus(userId) }, { headers }); }
  catch { return NextResponse.json({ error: 'Your result could not be checked. Try again.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: 'Invalid request.' }, { status: 403, headers });
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Sign in to check your answers.' }, { status: 401, headers });
  if (session.impersonation?.mode === 'view') return NextResponse.json({ error: 'This account view is read only.' }, { status: 403, headers });
  if (request.headers.get('X-Orientation-Account') !== userId) return NextResponse.json({ error: 'Your account changed. Reload before checking answers.' }, { status: 409, headers });
  // Bound body before parsing; quiz contains only six integer choices.
  const text = await request.text();
  if (text.length > 2048) return NextResponse.json({ error: 'Invalid answers.' }, { status: 400, headers });
  let input: unknown;
  try { input = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid answers.' }, { status: 400, headers }); }
  const result = gradeOrientation(input);
  if (!result) return NextResponse.json({ error: 'Answer each question, then try again.' }, { status: 400, headers });
  if (!result.passed) return NextResponse.json({ data: result }, { headers });
  try {
    const receipt = await grantOrientation(userId);
    return NextResponse.json({ data: { ...result, receipt } }, { headers });
  } catch {
    return NextResponse.json({ error: 'Your answers passed, but the upgrade could not be confirmed. Retry to recover it safely.' }, { status: 503, headers });
  }
}
