import { ClientPage } from "@/components/org/ClientPage";
import { PERSON_TABS, type PersonTab } from "@/lib/org-person-view";
import "@/components/org/person-page.css";

export const metadata = { title: "Participant" };

/** ?tab=notes|tasks|outcomes|shared|screen opens on that tab without fetching a shared item (the staff tour uses it). */
function readTab(value: string | string[] | undefined): PersonTab | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return PERSON_TABS.some((t) => t.key === v) ? (v as PersonTab) : undefined;
}

export default async function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, search] = await Promise.all([props.params, props.searchParams]);
  return <ClientPage clientId={params.id} startTab={readTab(search.tab)} />;
}
