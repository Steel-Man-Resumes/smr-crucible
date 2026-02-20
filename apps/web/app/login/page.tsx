import { signIn } from "../../auth";

export default function LoginPage() {
  const isDev = process.env.NODE_ENV === "development";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-3xl font-bold mb-8">Sign In</h1>

      {/* Dev quick-login — no email needed */}
      {isDev && (
        <form
          action={async (formData) => {
            "use server";
            await signIn("credentials", {
              email: formData.get("email") as string,
              redirectTo: "/dashboard",
            });
          }}
          className="flex flex-col gap-4 w-full max-w-sm mb-8"
        >
          <input
            type="email"
            name="email"
            placeholder="troyrichardcarr@gmail.com"
            defaultValue="troyrichardcarr@gmail.com"
            required
            className="px-4 py-2 border border-[var(--border)] rounded bg-[var(--card)] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-[var(--accent)] text-black rounded font-medium hover:brightness-110"
          >
            Dev Login (no email)
          </button>
        </form>
      )}

      {isDev && (
        <div className="w-full max-w-sm border-t border-[var(--border)] my-2 relative">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[var(--bg)] px-3 text-xs text-[var(--muted)]">or</span>
        </div>
      )}

      {/* Magic link login */}
      <form
        action={async (formData) => {
          "use server";
          await signIn("resend", formData);
        }}
        className="flex flex-col gap-4 w-full max-w-sm mt-4"
      >
        <input
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          className="px-4 py-2 border border-[var(--border)] rounded bg-[var(--card)] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-zinc-800 text-white rounded hover:bg-zinc-700"
        >
          Send Magic Link
        </button>
      </form>
    </main>
  );
}
