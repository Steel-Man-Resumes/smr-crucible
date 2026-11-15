"use client";

/**
 * The Vault (Phase 6.2) -- the user's lifelong document HOME. Guidance, not
 * gatekeeping. A justice-impacted person often loses paperwork every time they
 * move; this is one calm place to keep the documents that prove who they are and
 * what they have earned: IDs, certificates, reference letters, records, notes.
 *
 * DOCTRINE the copy must honor:
 *  - It is NOT a secrets vault. No passwords, no Social Security card, no bank
 *    logins. The header says so plainly.
 *  - It is theirs for life. Encrypted at rest, private to the account, and only
 *    they can download it (owner-exclusive proxy -- never a public link).
 *  - Plain, blunt, dignified. No editorializing.
 *
 * Bytes never render here; downloads go through /api/vault/documents/[id]/download.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  VAULT_CATEGORIES,
  MAX_VAULT_FILE_BYTES,
  type VaultCategory,
} from "@crucible/core/src/vaultDocumentShared";

interface VaultDoc {
  id: string;
  category: VaultCategory;
  label: string;
  original_filename: string | null;
  note: string | null;
  linked_job_id: string | null;
  mime_type: string;
  byte_size: number;
  created_at: string;
}

interface JobOption {
  id: string;
  job_title: string;
  company: string;
}

function fmtDate(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.txt,.doc,.docx,application/pdf,image/*,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function VaultDocumentsPage() {
  const t = useTranslations("refineryResume.documents");
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [statusMsg, setStatusMsg] = useState("");

  // Upload form state.
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<VaultCategory | "">("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [linkedJobId, setLinkedJobId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-item action state.
  const [editing, setEditing] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<VaultCategory | "">("");
  const [editLabel, setEditLabel] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editJob, setEditJob] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch("/api/vault/documents")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setDocs(d.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/applications")
      .then((r) => (r.ok ? r.json() : { applications: [] }))
      .then((d) =>
        setJobs(
          (d.applications || []).map((a: any) => ({
            id: a.id,
            job_title: a.job_title,
            company: a.company,
          }))
        )
      )
      .catch(() => {});
  }, [load]);

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function jobLabel(id: string | null): string | null {
    if (!id) return null;
    const j = jobs.find((x) => x.id === id);
    return j ? t("jobAt", { job: j.job_title, company: j.company }) : null;
  }

  function onPickFile(f: File | null) {
    setUploadError("");
    setFile(f);
    // Prefill the label from the filename (without extension) if empty.
    if (f && !label.trim()) {
      const base = f.name.replace(/\.[^.]+$/, "").slice(0, 200);
      setLabel(base);
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (uploading) return;
    setUploadError("");
    if (!file) {
      setUploadError(t("chooseFile"));
      return;
    }
    if (file.size > MAX_VAULT_FILE_BYTES) {
      setUploadError(t("tooBig"));
      return;
    }
    if (!category) {
      setUploadError(t("pickCategory"));
      return;
    }
    if (!label.trim()) {
      setUploadError(t("needName"));
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("category", category);
      fd.set("label", label.trim());
      if (note.trim()) fd.set("note", note.trim());
      if (linkedJobId) fd.set("linkedJobId", linkedJobId);

      const res = await fetch("/api/vault/documents", { method: "POST", body: fd });
      if (res.ok) {
        const { data } = await res.json();
        setDocs((prev) => [data, ...prev]);
        setStatusMsg(t("added", { label: data.label }));
        // Reset the form.
        setFile(null);
        setCategory("");
        setLabel("");
        setNote("");
        setLinkedJobId("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        const err = await res.json().catch(() => ({}));
        setUploadError(err?.error || t("addFailed"));
      }
    } catch {
      setUploadError(t("addFailed"));
    } finally {
      setUploading(false);
    }
  }

  function startEdit(d: VaultDoc) {
    setEditing(d.id);
    setEditCategory(d.category);
    setEditLabel(d.label);
    setEditNote(d.note || "");
    setEditJob(d.linked_job_id || "");
  }

  async function saveEdit(id: string) {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/vault/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: editCategory,
          label: editLabel.trim(),
          note: editNote.trim() || null,
          linkedJobId: editJob || null,
        }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setDocs((prev) =>
          prev.map((d) =>
            d.id === id
              ? {
                  ...d,
                  category: data.category,
                  label: data.label,
                  note: data.note,
                  linked_job_id: data.linked_job_id,
                }
              : d
          )
        );
        setStatusMsg(t("saved"));
        setEditing(null);
      } else {
        const err = await res.json().catch(() => ({}));
        setStatusMsg(err?.error || t("saveFailed"));
      }
    } catch {
      setStatusMsg(t("saveFailed"));
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(id: string) {
    if (deleting) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/vault/documents/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDocs((prev) => prev.filter((d) => d.id !== id));
        setStatusMsg(t("deleted"));
      } else {
        const err = await res.json().catch(() => ({}));
        setStatusMsg(err?.error || t("deleteFailed"));
      }
    } catch {
      setStatusMsg(t("deleteFailedRetry"));
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-12 text-t-phos-dim">{t("loading")}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white">{t("title")}</h1>
      <p className="text-sm uppercase tracking-wide text-t-phos-dim mt-1" data-testid="vault-subtitle">{t("subtitle")}</p>
      <p className="text-t-phos-dim mt-3">
        {t("intro")}
      </p>
      <p className="text-xs text-t-phos-dim mt-2" data-testid="vault-lanes-note">
        {t("lanesNote")}
      </p>
      <div className="mt-3 border border-t-line bg-t-panel px-4 py-3 text-sm text-t-phos-dim">
        <span className="font-semibold text-t-phos">{t("notPassword")}</span> {t("notPasswordBody")}
      </div>

      <p aria-live="polite" className="sr-only">{statusMsg}</p>

      {/* Upload */}
      <form onSubmit={upload} className="mt-8 border border-t-line bg-t-panel p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase text-t-phos">{t("addTitle")}</h2>

        <div>
          <label className="block text-xs text-t-phos-dim mb-1" htmlFor="v-file">
            {t("fileLabel")}
          </label>
          <input
            id="v-file"
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-t-phos file:mr-3 file:border file:border-t-line file:bg-t-panel-2 file:px-3 file:py-1.5 file:text-t-phos file:text-xs file:font-medium hover:file:border-t-phos-dim"
          />
          {file && (
            <p className="text-xs text-t-phos-dim mt-1">
              {file.name} ({fmtSize(file.size)})
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs text-t-phos-dim mb-1" htmlFor="v-cat">
            {t("kindLabel")}
          </label>
          <select
            id="v-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value as VaultCategory)}
            className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
          >
            <option value="">{t("pickCat")}</option>
            {VAULT_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {t(`cat.${c.key}.label`)}
              </option>
            ))}
          </select>
          {category && (
            <p className="text-xs text-t-phos-dim mt-1">
              {t(`cat.${category}.help`)}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs text-t-phos-dim mb-1" htmlFor="v-label">
            {t("nameLabel")}
          </label>
          <input
            id="v-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={200}
            placeholder={t("namePlaceholder")}
            className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-t-phos-dim mb-1" htmlFor="v-note">
            {t("noteLabel")}
          </label>
          <textarea
            id="v-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
          />
        </div>

        {jobs.length > 0 && (
          <div>
            <label className="block text-xs text-t-phos-dim mb-1" htmlFor="v-job">
              {t("jobLabel")}
            </label>
            <select
              id="v-job"
              value={linkedJobId}
              onChange={(e) => setLinkedJobId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
            >
              <option value="">{t("noJob")}</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {t("jobAt", { job: j.job_title, company: j.company })}
                </option>
              ))}
            </select>
          </div>
        )}

        {uploadError && (
          <p className="text-sm text-t-red" role="alert">
            {uploadError}
          </p>
        )}

        <button
          type="submit"
          disabled={uploading}
          className="t-focus px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright disabled:opacity-50"
        >
          {uploading ? t("adding") : t("addToVault")}
        </button>
      </form>

      {/* List, grouped by category */}
      {docs.length === 0 ? (
        <div className="mt-8 text-center text-t-phos-dim bg-t-panel border border-t-line px-5 py-12">
          {t("empty")}
        </div>
      ) : (
        <div className="mt-10 space-y-8">
          {VAULT_CATEGORIES.map((cat) => {
            const group = docs.filter((d) => d.category === cat.key);
            if (group.length === 0) return null;
            const isCollapsed = collapsed.has(cat.key);
            return (
              <section key={cat.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(cat.key)}
                  aria-expanded={!isCollapsed}
                  className="t-focus flex w-full items-center justify-between text-left mb-3 text-t-phos-dim"
                >
                  <span className="text-sm font-semibold uppercase">
                    {t(`cat.${cat.key}.label`)} ({group.length})
                  </span>
                  <span className="text-xs" aria-hidden="true">
                    {isCollapsed ? t("show") : t("hide")}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="space-y-3">
                    {group.map((d) => (
                      <div key={d.id} className="bg-t-panel border border-t-line p-4">
                        {editing === d.id ? (
                          <div className="space-y-3">
                            <input
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              maxLength={200}
                              className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
                            />
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value as VaultCategory)}
                              className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
                            >
                              {VAULT_CATEGORIES.map((c) => (
                                <option key={c.key} value={c.key}>
                                  {t(`cat.${c.key}.label`)}
                                </option>
                              ))}
                            </select>
                            <textarea
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              maxLength={2000}
                              rows={2}
                              placeholder={t("notePlaceholder")}
                              className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
                            />
                            {jobs.length > 0 && (
                              <select
                                value={editJob}
                                onChange={(e) => setEditJob(e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none"
                              >
                                <option value="">{t("noJob")}</option>
                                {jobs.map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {t("jobAt", { job: j.job_title, company: j.company })}
                                  </option>
                                ))}
                              </select>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => saveEdit(d.id)}
                                disabled={savingEdit || !editLabel.trim()}
                                className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright disabled:opacity-50"
                              >
                                {savingEdit ? t("saving") : t("save")}
                              </button>
                              <button
                                onClick={() => setEditing(null)}
                                className="text-xs text-t-phos-dim hover:text-t-white"
                              >
                                {t("cancel")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="font-medium text-t-white truncate">{d.label}</h3>
                                <p className="text-xs text-t-phos-dim mt-0.5">
                                  {d.original_filename ? `${d.original_filename} · ` : ""}
                                  {t("added2", { size: fmtSize(d.byte_size), date: fmtDate(d.created_at) })}
                                </p>
                                {d.note && (
                                  <p className="text-sm text-t-phos mt-1 whitespace-pre-line">{d.note}</p>
                                )}
                                {jobLabel(d.linked_job_id) && (
                                  <p className="text-xs text-t-steel mt-1">
                                    {t("tiedTo", { job: jobLabel(d.linked_job_id) ?? "" })}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <a
                                  href={`/api/vault/documents/${d.id}/download`}
                                  className="t-focus px-3 py-1.5 text-xs font-bold bg-t-amber text-white hover:bg-t-amber-bright"
                                >
                                  {t("download")}
                                </a>
                                <button
                                  onClick={() => startEdit(d)}
                                  className="t-focus px-3 py-1.5 text-xs font-medium bg-t-panel-2 border border-t-line text-t-phos hover:border-t-phos-dim"
                                >
                                  {t("edit")}
                                </button>
                                {confirmDelete === d.id ? (
                                  <>
                                    <button
                                      onClick={() => remove(d.id)}
                                      disabled={deleting === d.id}
                                      className="t-focus px-2 py-1.5 text-xs font-medium bg-t-red text-white hover:opacity-90 disabled:opacity-50"
                                    >
                                      {deleting === d.id ? "..." : t("delete")}
                                    </button>
                                    <button
                                      onClick={() => setConfirmDelete(null)}
                                      className="text-xs text-t-phos-dim hover:text-t-white"
                                    >
                                      {t("cancel")}
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDelete(d.id)}
                                    className="text-xs text-t-phos-dim hover:text-t-red"
                                  >
                                    {t("delete")}
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-10 text-xs text-t-phos-dim">
        {t.rich("footer", { link: (chunks) => <Link href="/dashboard/settings#settings-export" className="text-t-amber-bright hover:text-t-amber">{chunks}</Link> })}
      </p>
    </div>
  );
}
