/**
 * The person context a tailoring run needs, loaded ONCE per batch and reused
 * for every job (Forge facts, base resume identity, approved base, parent).
 * Same sources and the same rules as the single-job hand-off in
 * components/resume/ResumeWorkspace.tsx (runCareerPackage), which is left
 * unchanged so the single-job path behaves exactly as before.
 */
import { readOwnForgeSession } from "./forge-carry";
import { isSamePerson } from "./is-same-person";

export interface TailorContext {
  generator: {
    forgeOutput: unknown;
    resumeText?: string;
    contact: Record<string, string>;
    challenges: string[];
    criminalRecord: unknown;
    approvedArtifactId?: string;
  };
  parentArtifactId: string | null;
}

export async function loadTailorContext(ownerUid: string | null | undefined, laneId: string | null, send: typeof fetch = fetch): Promise<TailorContext> {
  let forgeOutput: any = null;
  let resumeText: string | undefined;
  let contactInfo: any = {};
  let challenges: string[] = [];
  let criminalRecord: any = null;
  let baseDocContact: any = null;
  try {
    const session = readOwnForgeSession(ownerUid);
    if (session) {
      forgeOutput = session.forgeOutput;
      resumeText = session.resumeText;
      challenges = session.challenges || [];
      criminalRecord = session.criminalRecord || null;
      if (session.resumeDoc?.contact?.name) baseDocContact = session.resumeDoc.contact;
    }
  } catch {}
  if (!forgeOutput) {
    try {
      const res = await send("/api/forge/load");
      if (res.ok) {
        const { data } = await res.json();
        if (data) {
          forgeOutput = data.forgeOutput;
          resumeText = data.resumeText;
          challenges = data.challenges || [];
          criminalRecord = data.criminalRecord || null;
        }
      }
    } catch {}
  }
  let resumes: any[] = [];
  try {
    const artRes = await send("/api/artifacts?type=resume&limit=50&examples=hide");
    if (artRes.ok) resumes = (await artRes.json()).data || [];
  } catch {}
  if (!baseDocContact) {
    const base = resumes.find((a) => a?.target_context?.source === "forge" && a.content?.contact?.name);
    if (base) baseDocContact = base.content.contact;
  }
  try {
    const profileRes = await send("/api/user/profile");
    if (profileRes.ok) {
      const { contact } = await profileRes.json();
      if (contact) contactInfo = contact;
    }
  } catch {}
  // The profile fills gaps only when it is the same person (see ResumeWorkspace).
  if (baseDocContact) {
    const fill: any = isSamePerson(baseDocContact.name, contactInfo.name) ? contactInfo : {};
    contactInfo = {
      name: baseDocContact.name || fill.name || "",
      phone: baseDocContact.phone || fill.phone || "",
      email: baseDocContact.email || fill.email || "",
      city: baseDocContact.city || fill.city || "",
      state: baseDocContact.state || fill.state || "",
    };
  }
  let activeId: string | null = null;
  try { activeId = localStorage.getItem("active_baseline_id"); } catch {}
  const laneCandidates = resumes.filter((a) => (a.lane_id || null) === (laneId || null));
  const approvedBase =
    laneCandidates.find((a) => a.id === activeId && (a.is_locked || a.is_current)) ||
    laneCandidates.find((a) => a.is_locked || a.is_current) || null;
  const forgeBase = laneCandidates.find((a) => a?.target_context?.source === "forge");
  return {
    generator: {
      forgeOutput, resumeText, contact: contactInfo, challenges, criminalRecord,
      ...(approvedBase?.id ? { approvedArtifactId: approvedBase.id } : {}),
    },
    parentArtifactId: approvedBase?.id || forgeBase?.id || null,
  };
}
