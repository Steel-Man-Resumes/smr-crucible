import { ClientPage } from "@/components/org/ClientPage";

export const metadata = { title: "Participant" };

export default function Page({ params }: { params: { id: string } }) {
  return <ClientPage clientId={params.id} />;
}
