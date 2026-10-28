import { StaffDirectoryWithSlots } from "@/components/org/DirectorySendTo";
export const metadata = { title: "Directory" };
// Slots for other lanes (WIRING NEEDED in the S1 report), filled in components/org/DirectorySendTo.tsx (a client
// component, since a server page cannot pass components as props): S5 Send to (SendToButton after a person pick), S6 Contribute.
export default function Page() { return <StaffDirectoryWithSlots />; }
