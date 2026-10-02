import { ClientPage } from "@/components/org/ClientPage";

export const metadata = { title: "Participant" };

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <ClientPage clientId={params.id} />;
}
