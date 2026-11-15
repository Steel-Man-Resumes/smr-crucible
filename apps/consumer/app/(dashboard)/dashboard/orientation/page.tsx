import { effectiveAuth as auth } from '@/lib/effective-auth';
import { OrientationQuiz } from '@/components/tour/OrientationQuiz';
import { ORIENTATION_LESSONS } from '@/lib/orientation-lessons';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function OrientationPage() {
  const t = await getTranslations('refineryHome.orientation');
  // The lessons come from lib/orientation-lessons.ts; each is said through the catalog by its place in the list, and shows as written if the catalog has no line for it.
  const say = (index: number, field: 'label' | 'idea' | 'explanation' | 'example', fallback: string) => (t.has(`lessons.${index}.${field}`) ? t(`lessons.${index}.${field}`) : fallback);
  const userId = (await auth())?.user?.id;
  if (!userId) return <p>{t('signIn')}</p>;
  return <main className="mx-auto max-w-2xl space-y-6 pb-16">
    <header><p className="font-term text-xs uppercase tracking-widest text-t-amber-bright">{t('kicker')}</p><h1 className="my-3 text-3xl font-bold text-t-white">{t('title')}</h1><p className="text-t-phos-dim">{t('intro')}</p></header>
    <nav className="flex flex-wrap gap-4 text-sm underline text-t-amber-bright" aria-label={t('navAria')}><Link href="/dashboard?tour=1">{t('tour')}</Link><Link href="/dashboard/settings?lesson=1">{t('settings')}</Link></nav>
    <details className="settings-lesson"><summary>{t('review')}</summary>{ORIENTATION_LESSONS.slice(0, -1).map((lesson, index) => <section key={lesson.label} className="mb-6"><h2 className="text-lg font-semibold">{say(index, 'label', lesson.label)}</h2><p>{say(index, 'idea', lesson.idea)}</p><p>{say(index, 'explanation', lesson.explanation)}</p><p className="orientation-small">{say(index, 'example', lesson.example)}</p></section>)}</details>
    <OrientationQuiz key={userId} accountId={userId} />
  </main>;
}
