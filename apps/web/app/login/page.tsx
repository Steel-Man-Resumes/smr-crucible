import { signIn } from "../../auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-3xl font-bold mb-8">Sign In</h1>
      <form
        action={async (formData) => {
          "use server";
          await signIn("resend", formData);
        }}
        className="flex flex-col gap-4 w-full max-w-sm"
      >
        <input
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          className="px-4 py-2 border border-zinc-300 rounded focus:outline-none focus:ring-2 focus:ring-zinc-500"
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
