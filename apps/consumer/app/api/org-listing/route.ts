/**
 * Organization Listing Request API
 *
 * Allows local organizations to submit a request to be listed
 * in the resource directory. Stores to DB, sends notification email.
 */

import { NextResponse } from "next/server";

export const maxDuration = 10;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_CATEGORIES = [
  "housing",
  "transportation",
  "legal",
  "id_documents",
  "mental_health",
  "substance",
  "education",
  "financial",
  "employment",
  "other",
];

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 100_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = await request.json();
    const {
      orgName,
      category,
      city,
      phone,
      website,
      description,
      contactName,
      contactEmail,
    } = body;

    // Validation
    const errors: string[] = [];
    if (!orgName?.trim()) errors.push("Organization name is required");
    if (!category || !VALID_CATEGORIES.includes(category))
      errors.push("Please select a category");
    if (!city?.trim()) errors.push("City is required");
    if (!description?.trim())
      errors.push("Please describe your services");
    if (!contactName?.trim()) errors.push("Contact name is required");
    if (!contactEmail?.trim() || !EMAIL_REGEX.test(contactEmail))
      errors.push("Valid email is required");

    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 400 });
    }

    // Store in DB
    const { insert } = await import("@crucible/core");
    await insert("org_listing_request", {
      org_name: orgName.trim(),
      category,
      city: city.trim(),
      phone: phone?.trim() || null,
      website: website?.trim() || null,
      description: description.trim(),
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim().toLowerCase(),
    });

    // Send notification email (best-effort)
    try {
      const resendKey = process.env.AUTH_RESEND_KEY;
      if (resendKey) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "noreply@steelmanresumes.com",
            to: "info@steelmanresumes.com",
            subject: `New Org Listing Request: ${orgName.trim()}`,
            text: `Organization: ${orgName}\nCategory: ${category}\nCity: ${city}\nPhone: ${phone || "N/A"}\nWebsite: ${website || "N/A"}\nDescription: ${description}\nContact: ${contactName} (${contactEmail})`,
          }),
        });
      }
    } catch {
      // Email notification failed — request is still saved in DB
    }

    return NextResponse.json({
      success: true,
      message:
        "Thank you! We'll review your submission and add you within 48 hours.",
    });
  } catch (error) {
    console.error("Org listing error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
