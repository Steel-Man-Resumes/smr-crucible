export default function CheckEmailPage() {
  return (
    <main className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-t-bg px-4 py-10 text-center font-body">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <h1 className="mb-4 text-2xl font-semibold text-t-white">Check your email</h1>
        <p className="text-base text-t-bone-dim">
          We sent you a magic link. Click the link in your email to sign in. If
          you don&apos;t see it, check your spam folder.
        </p>
      </div>
    </main>
  );
}
