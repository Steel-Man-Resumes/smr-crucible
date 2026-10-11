import { SecurityContent } from "@/components/SecurityContent";
import { recordStepOn } from "@/lib/server-switch";

// A server page, read per request: the record check copy shows only while
// that step is on (lib/server-switch.ts).
export const dynamic = "force-dynamic";

export default function DashboardSecurityPage() {
  return <SecurityContent showUserControls recordStep={recordStepOn()} />;
}
