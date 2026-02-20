import { auth } from "../auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Crucible</h1>
      {session?.user ? (
        <div className="text-center">
          <p className="text-lg mb-2">
            Signed in as{" "}
            <span className="font-semibold">{session.user.email}</span>
          </p>
          <form
            action={async () => {
              "use server";
              const { signOut } = await import("../auth");
              await signOut();
            }}
          >
            <button
              type="submit"
              className="mt-4 px-4 py-2 bg-zinc-800 text-white rounded hover:bg-zinc-700"
            >
              Sign Out
            </button>
          </form>
        </div>
      ) : (
        <div className="text-center">
          <p className="text-lg text-zinc-500 mb-4">Not signed in</p>
          <a
            href="/login"
            className="px-4 py-2 bg-zinc-800 text-white rounded hover:bg-zinc-700"
          >
            Sign In
          </a>
        </div>
      )}
    </main>
  );
}
