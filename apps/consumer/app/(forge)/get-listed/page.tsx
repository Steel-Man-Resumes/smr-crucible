"use client";

/**
 * Get Your Organization Listed — Public form
 *
 * No auth required. Local orgs submit info to be included
 * in the resource directory. Simple, fast, welcoming.
 */

import { useState } from "react";
import Link from "next/link";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { TBtn } from "@crucible/consumer-ui";
import { useTranslations } from "next-intl";

const CATEGORIES = [
  { value: "housing" },
  { value: "transportation" },
  { value: "legal" },
  { value: "id_documents" },
  { value: "mental_health" },
  { value: "substance" },
  { value: "education" },
  { value: "financial" },
  { value: "employment" },
  { value: "other" },
];

export default function GetListedPage() {
  const t = useTranslations("refineryShell.getListed");
  const [form, setForm] = useState({
    orgName: "",
    category: "",
    city: "",
    phone: "",
    website: "",
    description: "",
    contactName: "",
    contactEmail: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors([]);
  }

  /** The Turnstile token, when the env-gated widget is on the page. */
  function turnstileToken(): string | undefined {
    try {
      return document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value || undefined;
    } catch {
      return undefined;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);

    try {
      const res = await fetch("/api/org-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, turnstileToken: turnstileToken() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrors(data.errors || [data.error || t("wentWrongShort")]);
      } else {
        setSubmitted(true);
      }
    } catch {
      setErrors([t("wentWrong")]);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-t-bg">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-t-panel-2 border border-t-amber flex items-center justify-center mx-auto mb-6">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              className="text-t-amber"
            >
              <path
                d="M8 16l6 6 10-10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-t-white mb-3">
            {t("thanks")}
          </h1>
          <p className="text-base text-t-phos-dim mb-6 leading-relaxed">
            {t("thanksBody")}
          </p>
          <Link
            href="/intro"
            className="text-sm text-t-amber-bright hover:text-t-amber font-medium"
          >
            &larr; {t("back")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-t-bg px-4 py-12">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-t-white mb-2">
          {t("title")}
        </h1>
        <p className="text-base text-t-phos-dim mb-8 leading-relaxed">
          {t("lead")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Org name */}
          <Field
            label={t("orgName")}
            required
            value={form.orgName}
            onChange={(v) => update("orgName", v)}
            placeholder={t("orgNamePlaceholder")}
          />

          {/* Category */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              {t("category")} <span className="text-t-red">*</span>
            </label>
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            >
              <option value="">{t("categoryPlaceholder")}</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {t(`categories.${c.value}`)}
                </option>
              ))}
            </select>
          </div>

          {/* City */}
          <Field
            label={t("city")}
            required
            value={form.city}
            onChange={(v) => update("city", v)}
            placeholder={t("cityPlaceholder")}
          />

          {/* Phone */}
          <Field
            label={t("phone")}
            value={form.phone}
            onChange={(v) => update("phone", v)}
            placeholder="(414) 555-0100"
          />

          {/* Website */}
          <Field
            label={t("website")}
            value={form.website}
            onChange={(v) => update("website", v)}
            placeholder="https://yourorg.com"
          />

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              {t("description")}{" "}
              <span className="text-t-red">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              rows={4}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none resize-none"
            />
          </div>

          <hr className="t-rule" />

          <p className="text-xs text-t-phos-dim">
            {t("contactNote")}
          </p>

          {/* Contact name */}
          <Field
            label={t("yourName")}
            required
            value={form.contactName}
            onChange={(v) => update("contactName", v)}
            placeholder={t("yourNamePlaceholder")}
          />

          {/* Contact email */}
          <Field
            label={t("yourEmail")}
            required
            type="email"
            value={form.contactEmail}
            onChange={(v) => update("contactEmail", v)}
            placeholder="jane@yourorg.com"
          />

          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-t-panel p-4 border border-t-red">
              <ul className="text-sm text-t-red space-y-1">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Bot check: renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set */}
          <TurnstileWidget />

          {/* Submit */}
          <TBtn type="submit" disabled={submitting} className="w-full">
            {submitting ? t("submitting") : t("submit")}
          </TBtn>

          <p className="text-xs text-t-phos-dim text-center">
            {t("verifyNote")}
          </p>
        </form>
      </div>
    </div>
  );
}

// ─── Field Component ────────────────────────────────────────────────────────

function Field({
  label,
  required,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-t-white block mb-1">
        {label} {required && <span className="text-t-red">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
      />
    </div>
  );
}
