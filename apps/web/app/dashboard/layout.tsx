import { auth } from "../../auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
          Crucible
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--muted)]">
            {session.user.email}
          </span>
          <form
            action={async () => {
              "use server";
              const { signOut } = await import("../../auth");
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </form>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
