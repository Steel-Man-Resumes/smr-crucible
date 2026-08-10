import { SecurityContent } from "@/components/SecurityContent";

export const metadata = {
  title: "Security & Privacy — Steel Man Resumes",
  description:
    "How we protect your data. No ads, no ad networks, no selling your information. Plain answers about what we store and who can see it.",
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
