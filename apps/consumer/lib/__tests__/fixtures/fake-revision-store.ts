/**
 * A fake revision store for the Phase 6 S1 tests, the way R1's coreStore
 * behaves: every read AS the person (another user reads nothing), one list
 * of revisions, and the account's stored upload (serverSource). No database.
 */

import type { ArtifactLite } from "../../revision-save";
import type { LaneFirstStore } from "../../lane-first-save";
import { writerSourceFrom } from "../../writer-receipt";
import { revisionContentHash, type ArtifactRevision, type InsertRevisionResult, type NewRevision } from "@crucible/core/src/artifactRevision";

/** A store the way R1's coreStore behaves: reads AS the person, one list of revisions. */
export function fakeRevisionStore(UID: string, initial: ArtifactLite[] = [], serverText?: string) {
  const arts = [...initial];
  const revs: ArtifactRevision[] = [];
  /** The keepInsideLines each read of the stored upload asked for. */
  const keeps: boolean[] = [];
  const store: LaneFirstStore = {
    listResumeArtifacts: async () => arts,
    getArtifact: async (u, id) => (u === UID ? arts.find((a) => a.id === id) ?? null : null),
    createForgeArtifact: async (_u, content) => {
      const a = { id: `00000000-0000-4000-8000-0000000000${(10 + arts.length).toString(16)}`, artifact_type: "resume", target_context: { source: "forge" }, content };
      arts.push(a);
      return { id: a.id };
    },
    updateArtifactContent: async () => "updated",
    insertRevision: async (userId: string, r: NewRevision): Promise<InsertRevisionResult> => {
      const mine = revs.filter((x) => x.artifact_id === r.artifactId);
      const row = {
        id: `00000000-0000-4000-8000-00000000f${(100 + revs.length).toString(16)}`, user_id: userId, artifact_id: r.artifactId, revision_number: mine.length + 1,
        source: r.source, doc_kind: r.docKind, resume_text: r.resumeText, letter_text: r.letterText, kept_terms: r.keptTerms,
        confirmed_credentials: r.confirmedCredentials, defend_answers: r.defendAnswers, evidence: r.evidence, checker_version: r.checkerVersion,
        status: r.status, page_count: r.pageCount, page_limit: r.pageLimit, length_choice: r.lengthChoice, open_items: r.openItems, content_hash: revisionContentHash(r), created_at: "now",
      } as ArtifactRevision;
      revs.push(row);
      return { status: "saved", revision: row, reused: false };
    },
    getLatestRevision: async (u, id) => (u === UID ? revs.filter((x) => x.artifact_id === id).at(-1) ?? null : null),
    serverSource: async (_u, keep) => {
      keeps.push(keep);
      return serverText === undefined ? null : writerSourceFrom({ resumeText: serverText, keepInsideLines: keep });
    },
    createResumeArtifact: async (_u, targetContext, content) => {
      const a = { id: `00000000-0000-4000-8000-0000000001${(10 + arts.length).toString(16)}`, artifact_type: "resume", target_context: targetContext, content };
      arts.push(a);
      return { id: a.id };
    },
    getRevision: async (_u, id) => revs.find((x) => x.id === id) ?? null,
    listRevisions: async (_u, id) => revs.filter((x) => x.artifact_id === id),
  };
  return { store, arts, revs, keeps };
}

