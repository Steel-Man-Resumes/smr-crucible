import { StaffDirectoryPage } from "@/components/org/StaffDirectory";
export const metadata = { title: "Directory" };
// Slots for other lanes (WIRING NEEDED in the S1 report): S5 SendToButton as SendTo, S6 ListingContributeMenu as Contribute.
export default function Page() { return <StaffDirectoryPage />; }
