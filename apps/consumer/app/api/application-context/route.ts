import { NextResponse } from "next/server";
import { revisionCaller } from "@/lib/revision-route";
import { loadApplicationContext } from "@/lib/application-context";
export async function GET(request: Request) {
 const caller = await revisionCaller();
 if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
 const id = new URL(request.url).searchParams.get("applicationId") || "";
 if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid application" }, { status: 400 });
 try {
  const context = await loadApplicationContext(caller.userId, id);
  if (!context) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  return NextResponse.json(context, { headers: { "Cache-Control": "no-store" } });
 } catch { return NextResponse.json({ error: "Your saved job could not be loaded. Try again." }, { status: 503 }); }
}
