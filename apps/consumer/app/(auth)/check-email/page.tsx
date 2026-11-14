import { getTranslations } from "next-intl/server";

export default async function CheckEmailPage() {
  const t = await getTranslations("refineryShell.checkEmail");
  return (
    <main className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-t-bg px-4 py-10 text-center font-body">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <h1 className="mb-4 text-2xl font-semibold text-t-white">{t("title")}</h1>
        <p className="text-base text-t-bone-dim">
          {t("body")}
        </p>
      </div>
    </main>
  );
}
