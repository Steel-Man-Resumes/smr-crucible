/**
 * Tour Layout — minimal wrapper
 * The GlobalTourOverlay lives in root layout, so this just passes through.
 */
export default function TourLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
