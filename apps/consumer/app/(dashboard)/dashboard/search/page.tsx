import { StaffSearch } from "@/components/org/StaffSearch";
export const metadata = { title: "Find a person" };
export default function Page() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold text-t-white">Find a person</h1>
      <StaffSearch autoFocus />
    </div>
  );
}
