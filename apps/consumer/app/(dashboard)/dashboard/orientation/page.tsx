import { effectiveAuth as auth } from '@/lib/effective-auth';
import { OrientationQuiz } from '@/components/tour/OrientationQuiz';
import { ORIENTATION_LESSONS } from '@/lib/orientation-lessons';
import Link from 'next/link';

export default async function OrientationPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) return <p>Sign in to take the orientation check.</p>;
  return <main className="mx-auto max-w-2xl space-y-6 pb-16">
    <header><p className="font-term text-xs uppercase tracking-widest text-t-amber-bright">Learn the process</p><h1 className="my-3 text-3xl font-bold text-t-white">Your next move starts here.</h1><p className="text-t-phos-dim">Review the lessons, check your understanding, then use the tools with a clear purpose.</p></header>
    <nav className="flex flex-wrap gap-4 text-sm underline text-t-amber-bright" aria-label="Orientation"><Link href="/dashboard?tour=1">Take the guided tour</Link><Link href="/dashboard/settings?lesson=1">Explore settings</Link></nav>
    <details className="settings-lesson"><summary>Review the process before the check</summary>{ORIENTATION_LESSONS.slice(0, -1).map(lesson => <section key={lesson.label} className="mb-6"><h2 className="text-lg font-semibold">{lesson.label}</h2><p>{lesson.idea}</p><p>{lesson.explanation}</p><p className="orientation-small">{lesson.example}</p></section>)}</details>
    <OrientationQuiz key={userId} accountId={userId} />
  </main>;
}
