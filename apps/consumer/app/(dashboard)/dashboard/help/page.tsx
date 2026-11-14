"use client";

/**
 * Help & Feedback (Phase 8.1 + 8.4).
 *
 * ONE destination with five modes: report a bug, something is confusing, ask
 * for help, share an idea, and a message for Troy. Every mode writes the SAME
 * support_request row (category set to match) -- no parallel store.
 *
 * - Ask-for-help offers a RETRIEVAL-ONLY article match. Security/account/legal
 *   questions are never article-answered: they always become a human ticket.
 * - Opt-in context capture shows a redacted preview of exactly what will be
 *   attached (page + tier + a count of recent AI actions) before sending.
 * - Past submissions show their visible status; Troy's replies surface here.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import {
  readIdea,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  displaySupportStatus,
  classifySupportTopic,
  type SupportCategory,
} from "@crucible/core/src/supportRequestShared";
import { findHelpArticle } from "@/lib/helpArticles";
import { TOUR_HREF } from "@crucible/core/src/journeyStages";
import { useEffectiveRole } from "@/components/RoleProvider";
import { StaffHelp } from "@/components/help/StaffHelp";
import { useServerText } from "@/components/ServerTextProvider";
import { staffTourAllowed } from "@/lib/tour/staff-tour";

interface MineRow {
  id: string;
  category: string | null;
  message: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
  replied_at: string | null;
  context?: Record<string, unknown>;
}

export default function HelpPage() {
  const t = useTranslations("refineryHome.help");
  return <Suspense fallback={<p role="status">{t("loading")}</p>}><HelpContent /></Suspense>;
}

function HelpContent() {
  const t = useTranslations("refineryHome.help");
  const locale = useLocale();
  const words = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const ts = useServerText();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { data: session } = useSession();
  // The Settings tour is for clients; staff Settings has no coach section or lesson (SETTINGS-TOUR.md).
  // Staff get their own top (staff pass S2): the staff tour, t.ROY's staff skills, My setup, how to ask for a change.
  const role = useEffectiveRole();
  const isStaff = !!role?.orgRole;
  const settingsTourFor = !isStaff;
  const tier = ((session?.user as { tier?: string })?.tier) || "client";

  const [mode, setMode] = useState<SupportCategory>("help");
  const [text, setText] = useState("");
  const [includeContext, setIncludeContext] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const [savingPreference, setSavingPreference] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState("");

  useEffect(() => {
    if (searchParams.get("mode") === "idea") setMode("idea");
  }, [searchParams]);

  // Ask-for-help retrieval state
  const [articleShown, setArticleShown] = useState<
    { title: string; body: string } | null
  >(null);
  const [answeredBy, setAnsweredBy] = useState<"article" | null>(null);

  // Submit state
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [submitted, setSubmitted] = useState<{ id: string; forced?: boolean } | null>(
    null
  );

  // History
  const [mine, setMine] = useState<MineRow[]>([]);
  const [helpedCount, setHelpedCount] = useState(0);

  const loadMine = useCallback(() => {
    return fetch("/api/support-request/mine")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setMine(j.data ?? []);
        setHelpedCount(j.count ?? 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { void loadMine(); }, [loadMine]);

  function pickMode(next: SupportCategory) {
    setMode(next);
    setArticleShown(null);
    setAnsweredBy(null);
    setSubmitted(null);
    setStatus("idle");
  }

  // Ask-for-help: look for a quick answer. Sensitive topics skip articles and
  // become a human ticket right away.
  async function lookForAnswer() {
    const q = text.trim();
    if (!q) return;
    if (classifySupportTopic(q) === "sensitive") {
      // This needs a person -- file it and tell them.
      await submit(true, "help");
      return;
    }
    const match = findHelpArticle(q);
    if (match) {
      setArticleShown({ title: match.article.title, body: match.article.body });
      setAnsweredBy(null);
    } else {
      setArticleShown(null);
      // No article -- send it to a person.
      await submit(false, "help");
    }
  }

  // forcedHuman = the sensitive-topic path (we file it for the user and say so).
  const submit = useCallback(
    async (forcedHuman: boolean, category: SupportCategory) => {
      const message = text.trim();
      if (!message || status === "sending") return;
      setStatus("sending");
      try {
        const res = await fetch("/api/support-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            message,
            page: pathname.replace("/dashboard/", "") || "dashboard",
            includeContext: category === "idea" ? false : includeContext,
            followUp: category === "idea" && followUp,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        setSubmitted({ id: j.id, forced: forcedHuman });
        setStatus("sent");
        setText("");
        setArticleShown(null);
        loadMine();
      } catch {
        setStatus("error");
      }
    },
    [text, status, pathname, includeContext, followUp, loadMine]
  );

  async function changeFollowUp(id: string, allowed: boolean) {
    setPreferenceError("");
    setSavingPreference(id);
    try {
      const res = await fetch("/api/support-request/mine", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, followUp: allowed }) });
      if (!res.ok) throw new Error();
      await loadMine();
    } catch { setPreferenceError(t("contactNotSaved")); }
    finally { setSavingPreference(null); }
  }

  const shortId = submitted?.id ? submitted.id.slice(0, 8) : "";

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">{t("title")}</h1>
      <p className="text-base text-t-phos-dim mb-6">
        {isStaff
          ? "How to get the most from this workspace, and one place to report a problem, share an idea, or send Troy a note."
          : t("intro")}
      </p>

      {isStaff && <StaffHelp tourAllowed={staffTourAllowed(role)} capabilities={role?.capabilities ?? []} workspace={!!role?.crmV2} />}

      {!isStaff && <div className="mb-6 flex flex-wrap gap-3">
        <Link href={TOUR_HREF} className="t-focus inline-flex min-h-touch items-center border border-t-line px-4 py-2 text-sm font-semibold text-t-white hover:border-t-amber">
          {t("replayRefinery")}
        </Link>
        {settingsTourFor && <Link href="/dashboard/settings?tour=settings" className="t-focus inline-flex min-h-touch items-center border border-t-line px-4 py-2 text-sm font-semibold text-t-white hover:border-t-amber">
          {t("replaySettings")}
        </Link>}
      </div>}

      {!isStaff && <div className="mb-6 flex flex-wrap gap-4 text-sm text-t-amber-bright underline"><Link href="/dashboard/settings?lesson=1">{t("learnSettings")}</Link><Link href="/dashboard/orientation">{t("orientationCheck")}</Link></div>}

      {isStaff && <h2 className="text-lg font-bold text-t-white mb-3">Get help or tell us something</h2>}

      {/* Mode picker */}
      <div className="flex flex-wrap gap-2 mb-5">
        {SUPPORT_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pickMode(c)}
            className={`px-3 py-2 text-sm font-medium border transition-colors min-h-touch ${
              mode === c
                ? "border-t-amber bg-t-amber text-white"
                : "border-t-line text-t-phos-dim hover:border-t-phos-dim hover:text-t-white"
            }`}
          >
            {t(`modes.${c}.label`)}
          </button>
        ))}
      </div>

      <div className="bg-t-panel p-5 border border-t-line">
        <p className="text-sm text-t-phos-dim mb-3">{t(`modes.${mode}.blurb`)}</p>

        <label htmlFor="support-message" className="sr-only">{mode === "idea" ? t("ideaLabel") : t("messageLabel")}</label>
        <textarea
          id="support-message"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setArticleShown(null);
            setSubmitted(null);
            setStatus("idle");
          }}
          maxLength={2000}
          rows={4}
          placeholder={
            mode === "help"
              ? t("placeholder.help")
              : mode === "idea"
                ? t("placeholder.idea")
              : mode === "bug"
                ? t("placeholder.bug")
                : mode === "message"
                  ? t("placeholder.message")
                  : t("placeholder.other")
          }
          className="w-full px-3 py-2 bg-t-panel-2 border border-t-line text-t-white text-sm focus:border-t-amber focus:outline-none transition-colors"
        />

        {mode === "idea" && (
          <div className="mt-3 space-y-3 text-sm text-t-phos-dim">
            <p>{t("ideaNoPlan")}</p>
            <label className="flex items-start gap-3 text-t-white">
              <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="mt-1 accent-t-amber" />
              {t("ideaContact")}
            </label>
            <p>{t("ideaPermission")}</p>
            <p>{t("ideaNoPromise")}</p>
          </div>
        )}
        {/* Opt-in context capture + redacted preview */}
        {mode !== "idea" && <label className="flex items-start gap-3 mt-3 text-sm text-t-white cursor-pointer">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-t-amber flex-shrink-0"
          />
          <span>
            {t("includeContext")}
          </span>
        </label>}

        {mode !== "idea" && includeContext && (
          <div className="mt-2 border border-t-line bg-t-panel-2 p-3 text-xs text-t-phos-dim">
            <p className="font-semibold text-t-phos mb-1">
              {t("willInclude")}
            </p>
            <ul className="space-y-0.5">
              <li>{t("contextPage", { page: pathname.replace("/dashboard/", "") || "dashboard" })}</li>
              <li>{t("contextPlan", { tier })}</li>
              <li>{t("contextActions")}</li>
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2">
          {mode === "help" ? (
            <button
              type="button"
              onClick={lookForAnswer}
              disabled={!text.trim() || status === "sending"}
              className="t-focus px-4 py-2 bg-t-amber text-white text-sm font-medium hover:bg-t-amber-bright disabled:opacity-50 transition-colors min-h-touch"
            >
              {status === "sending" ? t("working") : t("lookQuick")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(false, mode)}
              disabled={!text.trim() || status === "sending"}
              className="t-focus px-4 py-2 bg-t-amber text-white text-sm font-medium hover:bg-t-amber-bright disabled:opacity-50 transition-colors min-h-touch"
            >
              {status === "sending"
                ? t("sending")
                : mode === "message"
                  ? t("sendToTroy")
                  : t("send")}
            </button>
          )}
        </div>

        {/* Retrieval-only article answer */}
        {articleShown && (
          <div className="mt-4 border border-t-line bg-t-panel-2 p-4">
            <h3 className="font-semibold text-t-white mb-1">{ts(articleShown.title)}</h3>
            <p className="text-sm text-t-phos-dim whitespace-pre-wrap">
              {ts(articleShown.body)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setAnsweredBy("article");
                  setArticleShown(null);
                  setText("");
                }}
                className="px-3 py-2 text-sm border border-t-line text-t-phos-dim hover:text-t-white min-h-touch"
              >
                {t("answeredIt")}
              </button>
              <button
                type="button"
                onClick={() => submit(false, "help")}
                disabled={status === "sending"}
                className="px-3 py-2 text-sm border border-t-amber text-t-amber-bright hover:bg-t-amber/10 min-h-touch"
              >
                {t("sendToPerson")}
              </button>
            </div>
          </div>
        )}

        {answeredBy === "article" && (
          <p className="mt-3 text-sm text-t-phos">{t("glad")}</p>
        )}

        {/* Confirmation */}
        {status === "sent" && submitted && (
          <div className="mt-4 border border-t-line bg-t-panel-2 p-4">
            {submitted.forced ? (
              <p className="text-sm text-t-white">
                {t.rich("sentForced", { id: shortId, strong: (chunks) => <strong>{chunks}</strong> })}
              </p>
            ) : (
              <p className="text-sm text-t-white">
                {t.rich("sent", { id: shortId, strong: (chunks) => <strong>{chunks}</strong> })}
              </p>
            )}
          </div>
        )}

        {status === "error" && (
          <p className="mt-3 text-sm text-t-red">
            {t("error")}
          </p>
        )}
      </div>

      {/* History */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-t-white">{t("submissions")}</h2>
          {helpedCount > 0 && (
            <span className="text-xs text-t-phos-dim">
              {t("submissionCount", { count: helpedCount })}
            </span>
          )}
        </div>

        {preferenceError && <p role="alert" className="mb-3 text-sm text-t-red">{preferenceError}</p>}
        {mine.length === 0 ? (
          <p className="text-sm text-t-phos-dim border border-t-line bg-t-panel p-4">
            {t("nothingYet")}
          </p>
        ) : (
          <div className="space-y-2">
            {mine.map((r) => (
              <div key={r.id} className="border border-t-line bg-t-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-t-phos-dim">
                    {r.category
                      ? ((SUPPORT_CATEGORY_LABELS as Record<string, string>)[r.category] !== undefined ? t(`modes.${r.category}.label`) : r.category)
                      : t("messageFallback")}{" "}
                    &middot; {new Date(r.created_at).toLocaleDateString(locale === "es" ? "es-US" : undefined)}
                  </span>
                  <span className="text-xs px-2 py-0.5 border border-t-line text-t-phos-dim">
                    {r.category === "idea" ? t(`stages.${readIdea(r.context, r.status).stage}`) : words(`status.${displaySupportStatus(r.status)}`, displaySupportStatus(r.status))}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-t-phos">
                  {r.message}
                </p>
                {r.category === "idea" && (
                  <div className="mt-3 space-y-2 text-sm">
                    {readIdea(r.context, r.status).update && <p className="whitespace-pre-wrap text-t-white">{readIdea(r.context, r.status).update}</p>}
                    <label className="flex items-start gap-3 text-t-phos-dim">
                      <input type="checkbox" disabled={savingPreference !== null} checked={readIdea(r.context, r.status).followUp} onChange={(e) => changeFollowUp(r.id, e.target.checked)} className="mt-1 accent-t-amber" />
                      {t("ideaContactShort")}
                    </label>
                  </div>
                )}
                {r.admin_reply && (
                  <div className="mt-3 border-l-2 border-t-amber pl-3">
                    <p className="text-xs font-semibold text-t-amber-bright mb-1">
                      {t("troyReplied")}
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-t-white">
                      {r.admin_reply}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
