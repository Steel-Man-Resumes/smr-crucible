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

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  displaySupportStatus,
  classifySupportTopic,
  type SupportCategory,
} from "@crucible/core/src/supportRequestShared";
import { findHelpArticle } from "@/lib/helpArticles";

interface MineRow {
  id: string;
  category: string | null;
  message: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
  replied_at: string | null;
}

const MODE_BLURB: Record<SupportCategory, string> = {
  bug: "Something broke or did not work the way you expected. Tell us what happened.",
  confusing: "Something was hard to follow. Tell us what did not make sense.",
  help: "Stuck on something? Ask your question. We may have a quick answer.",
  idea: "Have a suggestion? We read every one.",
  message: "Write a note straight to Troy, a real person. He reads them himself.",
};

export default function HelpPage() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const tier = ((session?.user as { tier?: string })?.tier) || "client";

  const [mode, setMode] = useState<SupportCategory>("help");
  const [text, setText] = useState("");
  const [includeContext, setIncludeContext] = useState(false);

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
    fetch("/api/support-request/mine")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setMine(j.data ?? []);
        setHelpedCount(j.count ?? 0);
      })
      .catch(() => {});
  }, []);

  useEffect(loadMine, [loadMine]);

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
            includeContext,
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
    [text, status, pathname, includeContext, loadMine]
  );

  const shortId = submitted?.id ? submitted.id.slice(0, 8) : "";

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">Help &amp; Feedback</h1>
      <p className="text-base text-t-phos-dim mb-6">
        One place to get help, report a problem, share an idea, or send Troy a
        note. Pick what fits.
      </p>

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
            {SUPPORT_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="bg-t-panel p-5 border border-t-line">
        <p className="text-sm text-t-phos-dim mb-3">{MODE_BLURB[mode]}</p>

        <textarea
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
              ? "What do you need help with?"
              : mode === "bug"
                ? "What happened, and what did you expect?"
                : mode === "message"
                  ? "What would you like Troy to know?"
                  : "Type here..."
          }
          className="w-full px-3 py-2 bg-t-panel-2 border border-t-line text-t-white text-sm focus:border-t-amber focus:outline-none transition-colors"
        />

        {/* Opt-in context capture + redacted preview */}
        <label className="flex items-start gap-3 mt-3 text-sm text-t-white cursor-pointer">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-t-amber flex-shrink-0"
          />
          <span>
            Include what page I&apos;m on and my recent activity to help debug
            (optional)
          </span>
        </label>

        {includeContext && (
          <div className="mt-2 border border-t-line bg-t-panel-2 p-3 text-xs text-t-phos-dim">
            <p className="font-semibold text-t-phos mb-1">
              Here is what we&apos;ll include:
            </p>
            <ul className="space-y-0.5">
              <li>Page: {pathname.replace("/dashboard/", "") || "dashboard"}</li>
              <li>Your plan: {tier}</li>
              <li>Up to 3 recent AI actions (no message text, no personal info)</li>
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
              {status === "sending" ? "Working..." : "Look for a quick answer"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(false, mode)}
              disabled={!text.trim() || status === "sending"}
              className="t-focus px-4 py-2 bg-t-amber text-white text-sm font-medium hover:bg-t-amber-bright disabled:opacity-50 transition-colors min-h-touch"
            >
              {status === "sending"
                ? "Sending..."
                : mode === "message"
                  ? "Send to Troy"
                  : "Send"}
            </button>
          )}
        </div>

        {/* Retrieval-only article answer */}
        {articleShown && (
          <div className="mt-4 border border-t-line bg-t-panel-2 p-4">
            <h3 className="font-semibold text-t-white mb-1">{articleShown.title}</h3>
            <p className="text-sm text-t-phos-dim whitespace-pre-wrap">
              {articleShown.body}
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
                That answered it
              </button>
              <button
                type="button"
                onClick={() => submit(false, "help")}
                disabled={status === "sending"}
                className="px-3 py-2 text-sm border border-t-amber text-t-amber-bright hover:bg-t-amber/10 min-h-touch"
              >
                No, send it to a person
              </button>
            </div>
          </div>
        )}

        {answeredBy === "article" && (
          <p className="mt-3 text-sm text-t-phos">Glad that helped.</p>
        )}

        {/* Confirmation */}
        {status === "sent" && submitted && (
          <div className="mt-4 border border-t-line bg-t-panel-2 p-4">
            {submitted.forced ? (
              <p className="text-sm text-t-white">
                This needs a person, so we filed it for you. Your request is in
                (#{shortId}), status <strong>received</strong>. Troy&apos;s reply
                will show up below.
              </p>
            ) : (
              <p className="text-sm text-t-white">
                Got it. Your request is in (#{shortId}), status{" "}
                <strong>received</strong>. Any reply from Troy shows up below.
              </p>
            )}
          </div>
        )}

        {status === "error" && (
          <p className="mt-3 text-sm text-t-red">
            That did not go through. Try again in a moment.
          </p>
        )}
      </div>

      {/* History */}
      <section className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-t-white">Your submissions</h2>
          {helpedCount > 0 && (
            <span className="text-xs text-t-phos-dim">
              You have helped improve this {helpedCount} time
              {helpedCount === 1 ? "" : "s"}.
            </span>
          )}
        </div>

        {mine.length === 0 ? (
          <p className="text-sm text-t-phos-dim border border-t-line bg-t-panel p-4">
            Nothing yet. When you send something, it shows up here with its
            status.
          </p>
        ) : (
          <div className="space-y-2">
            {mine.map((r) => (
              <div key={r.id} className="border border-t-line bg-t-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-t-phos-dim">
                    {r.category
                      ? SUPPORT_CATEGORY_LABELS[r.category as SupportCategory] ??
                        r.category
                      : "Message"}{" "}
                    -- {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs px-2 py-0.5 border border-t-line text-t-phos-dim">
                    {displaySupportStatus(r.status)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-t-phos">
                  {r.message}
                </p>
                {r.admin_reply && (
                  <div className="mt-3 border-l-2 border-t-amber pl-3">
                    <p className="text-xs font-semibold text-t-amber-bright mb-1">
                      Troy replied:
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
