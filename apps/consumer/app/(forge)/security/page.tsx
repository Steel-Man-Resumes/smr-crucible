import { SecurityContent } from "@/components/SecurityContent";

export const metadata = {
  title: "Security & Privacy — Steel Man Resumes",
  description:
    "How we protect your data. No ads, no tracking, no sharing. Your information stays private.",
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-t-bg px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <SecurityContent />
      </div>
    </div>
  );
}
