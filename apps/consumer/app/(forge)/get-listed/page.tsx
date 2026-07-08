"use client";

/**
 * Get Your Organization Listed — Public form
 *
 * No auth required. Local orgs submit info to be included
 * in the resource directory. Simple, fast, welcoming.
 */

import { useState } from "react";
import Link from "next/link";
import { TBtn } from "@crucible/consumer-ui";

const CATEGORIES = [
  { value: "housing", label: "Housing & Shelter" },
  { value: "transportation", label: "Transportation" },
  { value: "legal", label: "Legal Aid" },
  { value: "id_documents", label: "ID & Documents" },
  { value: "mental_health", label: "Mental Health" },
  { value: "substance", label: "Recovery Support" },
  { value: "education", label: "Education & Training" },
  { value: "financial", label: "Financial Literacy" },
  { value: "employment", label: "Employment Help" },
  { value: "other", label: "Other" },
];

export default function GetListedPage() {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);

    try {
      const res = await fetch("/api/org-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrors(data.errors || [data.error || "Something went wrong"]);
      } else {
        setSubmitted(true);
      }
    } catch {
      setErrors(["Something went wrong. Please try again."]);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12 font-term bg-t-bg">
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
            Thank you!
          </h1>
          <p className="text-base text-t-phos-dim mb-6 leading-relaxed">
            We&apos;ll review your submission and add your organization within
            48 hours. We may reach out if we need more information.
          </p>
          <Link
            href="/intro"
            className="text-sm text-t-amber-bright hover:text-t-amber font-medium"
          >
            &larr; Back to Steel Man Resumes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-t-bg px-4 py-12 font-term">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Get Your Organization Listed
        </h1>
        <p className="text-base text-t-phos-dim mb-8 leading-relaxed">
          We&apos;re building a network of verified resources for people
          rebuilding their careers in Milwaukee and Waukesha. If your
          organization offers support services, we want to connect people to
          you.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Org name */}
          <Field
            label="Organization Name"
            required
            value={form.orgName}
            onChange={(v) => update("orgName", v)}
            placeholder="e.g., Milwaukee Community Services"
          />

          {/* Category */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Category <span className="text-t-red">*</span>
            </label>
            <select
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            >
              <option value="">Select a category</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* City */}
          <Field
            label="City"
            required
            value={form.city}
            onChange={(v) => update("city", v)}
            placeholder="e.g., Milwaukee"
          />

          {/* Phone */}
          <Field
            label="Phone"
            value={form.phone}
            onChange={(v) => update("phone", v)}
            placeholder="(414) 555-0100"
          />

          {/* Website */}
          <Field
            label="Website"
            value={form.website}
            onChange={(v) => update("website", v)}
            placeholder="https://yourorg.com"
          />

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Describe Your Services{" "}
              <span className="text-t-red">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="What services do you offer? Who can access them? Any eligibility requirements?"
              rows={4}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none resize-none"
            />
          </div>

          <hr className="t-rule" />

          <p className="text-xs text-t-phos-dim">
            We&apos;ll use this to reach you if we have questions.
          </p>

          {/* Contact name */}
          <Field
            label="Your Name"
            required
            value={form.contactName}
            onChange={(v) => update("contactName", v)}
            placeholder="Jane Smith"
          />

          {/* Contact email */}
          <Field
            label="Your Email"
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

          {/* Submit */}
          <TBtn type="submit" disabled={submitting} className="w-full">
            {submitting ? "submitting..." : "submit for review"}
          </TBtn>

          <p className="text-xs text-t-phos-dim text-center">
            We verify every submission. Your organization will be live within
            48 hours.
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
