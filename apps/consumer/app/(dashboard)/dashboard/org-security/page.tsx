/**
 * /dashboard/org-security -- the security statement for organizations.
 *
 * Separate from the participant-facing /dashboard/security page on purpose.
 * A participant is asking "is my information safe here". An organization is
 * asking "can I sign something that says this is safe", which is a different
 * question with a different reader and a different burden of proof.
 */
import { OrgSecurityStatement } from "@/components/org/OrgSecurityStatement";

export default function OrgSecurityPage() {
  return <OrgSecurityStatement />;
}
