import type { Metadata } from "next";
import { CoBrandLockup, ProductFamilyBrand } from "@/components/brand/BrandMarks";

export const metadata: Metadata = {
  title: "Sign in to The Refinery",
  icons: {
    icon: [{ url: "/brand/refinery-icon.png", type: "image/png", sizes: "512x512" }],
  },
  robots: "noindex, nofollow",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="refinery-app min-h-screen bg-t-bg">
      <header className="border-b border-t-line bg-white">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <ProductFamilyBrand product="refinery" productHref="/login" />
          <CoBrandLockup compact className="hidden sm:flex" />
        </div>
      </header>
      {children}
    </div>
  );
}
