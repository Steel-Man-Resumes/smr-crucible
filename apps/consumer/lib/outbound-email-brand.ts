/**
 * Outbound branding for organization emails (migration 107, staff pass
 * 2026-10-27 lane S2). Every invite and team email the organization sends
 * through the Refinery is signed the organization's way: "<Organization>
 * with Steel Man Resumes" by default, the organization's name alone when it
 * is exclusive. The body still names Steel Man Resumes wherever it names the
 * account the person signs in to: that is the truth of where they are going,
 * whatever the branding.
 *
 * Pure: it rewrites the signature of a built email (lib/org-invite-email.ts),
 * so every builder keeps one shape and the brand is applied in one place.
 */
import type { OutboundBrand } from "@crucible/core/src/orgOutboundBrandShared";

export interface EmailContent { subject: string; html: string; text: string }

const TEXT_SIGNATURE = "Steel Man Resumes\nTruth. Told Strong.";
const HTML_SIGNATURE = "Steel Man Resumes<br>Truth. Told Strong.";

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The email with its signature in the organization's format. Content without the standard signature passes through unchanged. */
export function brandOrgEmail(content: EmailContent, brand: OutboundBrand): EmailContent {
  if (!brand.orgName) return content;
  const textSig = brand.coBranded ? `${brand.line}\nTruth. Told Strong.` : brand.line;
  const htmlSig = brand.coBranded ? `${escHtml(brand.line)}<br>Truth. Told Strong.` : escHtml(brand.line);
  return {
    subject: content.subject,
    text: content.text.split(TEXT_SIGNATURE).join(textSig),
    html: content.html.split(HTML_SIGNATURE).join(htmlSig),
  };
}
