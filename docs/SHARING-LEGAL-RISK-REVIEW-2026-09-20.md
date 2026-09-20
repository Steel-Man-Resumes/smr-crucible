# Sharing wording review — September 20, 2026

Status: AI-assisted legal-risk and implementation review, not an attorney opinion or launch clearance. Required sharing remains demo-only. No organization flags or production records were changed. D7 copy has been rewritten locally; D2 attorney review remains outstanding.

## Findings and disposition

| Finding | Change / remaining decision |
| --- | --- |
| Absolute “Not your case manager” and “no third parties” promises conflict with scoped sharing. | Rewrote the shared security component and related partner copy; covered membership visibility, staff access, recipients, revocation limits and legally required disclosures. Historical plan now points to canonical copy. |
| Required acknowledgement names only a case manager even when administrators are recipients. | Changed to refer to the displayed audience, including administrators. |
| “Until you acknowledge … sees only that you have not” ignores membership records and prior voluntary grants. | Explicitly preserved those exceptions. |
| “From today on” suggests midnight rather than acknowledgement time. | Matched `covers_from = now()` in migration 054; preserved prior voluntary grants. |
| “Stored documents can never be required” conflicts with cover letters and sounds like a legal rule binding programs. | Limited the promise to this feature and named vault files separately. Warned that sensitive content inside shared materials remains visible. |
| Funding preset promises no penalties without evidence. | Removed that promise and made the preset require the actual agreement, recipients, requested information and consequences before publication. Existing saved policies are unchanged. |
| Stopping access cannot erase copies or settle external obligations. | Clarified effects on platform access separately from program services, benefits and court/supervision requirements. No permission is needed to use the stop control. |
| Staff-note “ownership” could imply no legal access rights. | Replaced with who manages the records and distinguished in-app display from records requests. |
| Institutional LMS holds intake answers. | Added the institution's separate control of that copy to SCORM documentation. Participant intake notice still needs verification before institutional launch. |

## Remaining release blockers

1. **Organization-specific authority and consequences.** Obtain the actual program/funding terms, applicable states, participant population, data recipients, retention rules, alternatives and refusal consequences. A free-text reason is not evidence of legal authority. The court-reporting and funding presets are not approved reporting workflows. Identify an accountable program contact and supply an accurate explanation before acknowledgement.
2. **Acknowledgement is not a substitute for legally required authorization.** Determine whether the organization and records fall under HIPAA, Part 2, education confidentiality rules, state privacy law, or funding conditions. Those regimes are not automatically applicable just because users are justice-impacted. Do not enable health/treatment-record or court-reporting uses on the strength of this copy review.
3. **Text-version integrity.** New copy is `2026-09-20.3`. `sharingPolicy.ts` currently omits stored `text_version` from its public policy model; `smr_acknowledge_policy` writes the policy's stored text version into grants, while the UI renders current text constants. Consequently, an old active policy can show new words but record an older version. Before real rollout, implement version-aware rendering or reject stale versions and require replacement policies, preserving historical wording and acknowledgement evidence. Do not relabel existing acknowledgements. No existing policies were changed in this task.
4. **Operational corroboration.** Confirm retention/deletion of organization notes and copies, downstream reporting, staff reassignment, lawful-request handling, and the exact participant-facing LMS notice against deployed behavior and contracts. This was a source/copy review, not a production access or legal-process audit.
5. **Attorney gate.** Counsel must assess the actual organizations and approve the exact notice and workflow. Keep `required_sharing_enabled` disabled for real organizations. Do not treat this document as that approval. The copy revision alone also does not authorize switching `crm_v2` on.

## Sources and legal reasoning

- [FTC privacy and security guidance](https://www.ftc.gov/business-guidance/privacy-security): privacy promises must match actual practices. Applied here, absolute exclusions are misleading when the product permits participant-authorized staff access. This is a risk assessment, not a finding of a statutory violation or a determination of FTC jurisdiction over every participating organization.
- [HHS HIPAA Privacy Rule summary](https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html): where HIPAA applies, some uses require authorization and others have different permitted bases. Calling a click “acknowledgement” cannot decide which basis applies.
- [HHS Part 2 guidance](https://www.hhs.gov/hipaa/part-2/index.html): qualifying SUD records have special use, disclosure and legal-proceeding protections; compliance with the revised rule was required February 16, 2026. Applicability depends on program and record facts. This review does not approve handling those records.
- [20 CFR 683.220, official 2025 CFR publication](https://www.govinfo.gov/content/pkg/CFR-2025-title20-vol4/pdf/CFR-2025-title20-vol4-part683.pdf): WIOA title I and Wagner-Peyser recipients/subrecipients must safeguard sensitive information consistently with applicable privacy laws. This source supports safeguards, not a claim that a grant requires sharing whole resumes or application histories. Confirm current rules and the actual award before rollout.

Sources consulted September 20, 2026. No determination of state-specific requirements is possible without the participating organization's jurisdiction and program facts.
