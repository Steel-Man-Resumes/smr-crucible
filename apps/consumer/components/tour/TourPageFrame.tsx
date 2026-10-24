"use client";
import { useEffect, useRef, type ReactNode } from 'react';

/** Route commit, not a claim that every query on the page has finished. */
const PAGES: Record<string, [string, string]> = {
  '/dashboard': ['overview', 'Overview'], '/dashboard/jobs': ['jobs', 'Find work'],
  '/dashboard/vault': ['resumes', 'My resumes'], '/dashboard/applications': ['applications', 'Applications'],
  '/dashboard/interview': ['interview', 'Interview prep'], '/dashboard/resources': ['support', 'Support & disclosure'],
  '/dashboard/settings': ['settings', 'Settings'], '/dashboard/next': ['next', 'What comes next'],
};
export function TourPageFrame({ pathname, children }: { pathname: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let second = 0;
    const frame = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      element.dataset.assistantPageReady = pathname;
      window.dispatchEvent(new CustomEvent('refinery-page-ready', { detail: { pathname } }));
    }); });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(second); delete element.dataset.assistantPageReady; };
  }, [pathname]);
  const page = PAGES[pathname];
  return <div ref={ref} id={page ? `refinery-page-${page[0]}` : undefined} role="region" aria-label={page?.[1] || 'Current workspace page'} tabIndex={-1} data-tour-page={pathname}>{children}</div>;
}
