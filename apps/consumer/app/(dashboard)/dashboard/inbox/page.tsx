import { InboxPage } from "@/components/org/InboxPage";

export const metadata = { title: "Inbox" };

/** ?view=team opens the Team board (links from a team-thread mention land there). */
export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await props.searchParams;
  const v = Array.isArray(search.view) ? search.view[0] : search.view;
  return <InboxPage startView={v === "team" ? "team" : "inbox"} />;
}
