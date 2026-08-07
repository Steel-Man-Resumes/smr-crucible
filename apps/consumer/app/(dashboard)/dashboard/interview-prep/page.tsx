import { redirect } from "next/navigation";

/**
 * F8: `/dashboard/interview-prep` used to 404 (the real page is /dashboard/interview).
 * Keep a permanent redirect so old links, bookmarks, and any stale assistant route
 * land on the working page instead of a dead end.
 */
export default function InterviewPrepRedirect() {
  redirect("/dashboard/interview");
}
