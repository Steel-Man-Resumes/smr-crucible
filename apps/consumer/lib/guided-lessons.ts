export type GuidedPart = 'story' | 'map' | 'pages';

export interface GuidedLesson {
  id: string;
  part: GuidedPart;
  title: string;
  message: string;
  observation: string;
  route: string;
  targets: string[];
  concept?: 'process' | 'facts' | 'coach';
  group?: string;
}

export const GUIDED_PART_LABELS: Record<GuidedPart, string> = {
  story: 'The big picture',
  map: 'Where things fit',
  pages: 'Your real workspace',
};

export const GUIDED_LESSONS: readonly GuidedLesson[] = [
  {
    id: 'story-process', part: 'story', title: 'You did the hard part. Take a look around.',
    message: 'The Forge helped you put your work into words. Here, we put it to use. Find a job, prepare, apply, then practice for the conversation. After an offer, there may be checks and more steps.',
    observation: 'You can return to any part when your plans change.',
    route: '/dashboard', targets: [], concept: 'process',
  },
  {
    id: 'story-facts', part: 'story', title: 'Strong starts with true',
    message: 'Start with work you actually did. For each job, choose the details that fit. Keep one true history. Every line should be something you can explain in your own words.',
    observation: 'Different job. Different details. The same facts.',
    route: '/dashboard', targets: [], concept: 'facts',
  },
  {
    id: 'story-coach', part: 'story', title: 'Meet t.ROY',
    message: "I'm t.ROY, your AI coach. I can help you find words and practice. Ask about this page, or ask me to guide you to another tool. Check my suggestions. I can get things wrong. You choose what stays.",
    observation: 'A suggestion is not a saved change or a sent application.',
    route: '/dashboard', targets: [], concept: 'coach',
  },
  {
    id: 'map-direction', part: 'map', title: 'Choose a direction',
    message: 'Find work brings jobs, paths and employer information together. Look for work that fits your skills and needs.',
    observation: 'These choices live under Find work.',
    route: '/dashboard', targets: ['refinery-nav-jobs'], group: 'Choose a direction',
  },
  {
    id: 'map-work', part: 'map', title: 'Build and use your work',
    message: 'My resumes holds your documents. Applications tracks each job. Interview prep helps you practice telling the story behind your work.',
    observation: 'Your facts connect the page, the application and the conversation.',
    route: '/dashboard', targets: ['refinery-nav-resumes', 'refinery-nav-applications', 'refinery-nav-interview'], group: 'Build and use your work',
  },
  {
    id: 'map-support', part: 'map', title: 'Get help and keep your place',
    message: 'Overview helps you choose a next step. Support & disclosure covers practical help and record conversations. Settings holds reading, coaching and sharing choices.',
    observation: "Let's open the real pages. No forms to fill out yet.",
    route: '/dashboard', targets: ['refinery-nav-overview', 'refinery-nav-support', 'refinery-nav-settings'], group: 'Get help and keep your place',
  },
  {
    id: 'page-overview', part: 'pages', title: 'Overview',
    message: "This is your home base. See what's here and choose one next step. When you return, start here to get your bearings.",
    observation: 'One useful next step is enough to begin.',
    route: '/dashboard', targets: ['refinery-tool-overview-next'],
  },
  {
    id: 'page-jobs', part: 'pages', title: 'Find work',
    message: "Start with ordinary job listings. Add what we know about employers for more context. No research mark does not mean no chance. You choose the filters; research adds possibilities.",
    observation: 'Start with the work you want. Then set the place and check your search choices.',
    route: '/dashboard/jobs', targets: ['refinery-tool-jobs-query'],
  },
  {
    id: 'page-resumes', part: 'pages', title: 'My resumes',
    message: 'Build from your Master Draft. Keep a separate version for each job, using the same facts. Check any suggested changes before using the document.',
    observation: 'This choice tells you which goal these documents belong to.',
    route: '/dashboard/vault', targets: ['refinery-tool-resume-lane'],
  },
  {
    id: 'page-applications', part: 'pages', title: 'Applications',
    message: 'Track each job here. A prepared packet has not been submitted. Apply the way the employer asks, then mark the job Applied.',
    observation: 'Update the status when something actually happens.',
    route: '/dashboard/applications', targets: ['refinery-tool-application-overview'],
  },
  {
    id: 'page-interview', part: 'pages', title: 'Interview prep',
    message: "Practice with a real example in your own words. If you can't explain a line, fix it. Use feedback to make your next answer clearer.",
    observation: 'Name the role here. Practice its questions with real examples, then try the follow-up.',
    route: '/dashboard/interview', targets: ['refinery-tool-interview-role'],
  },
  {
    id: 'page-support', part: 'pages', title: 'Support & disclosure',
    message: 'Look for help with a practical need. Check service details before relying on a listing. Disclosure tools help you prepare a record conversation.',
    observation: 'Check who can use a service. Ask t.ROY to file a request for Troy; you confirm what is sent.',
    route: '/dashboard/resources', targets: ['refinery-tool-support-query'],
  },
  {
    id: 'page-settings', part: 'pages', title: 'Settings',
    message: 'Choose reading help and coaching style here. Before sharing, check what information is requested and who sees it. Sponsored access does not mean you share everything.',
    observation: 'Reading help, coaching and sharing each have their own place. The deeper lesson is here too.',
    route: '/dashboard/settings', targets: ['refinery-tool-settings-map'],
  },
];

export const GUIDED_ENDING = {
  title: 'Try what you learned',
  message: 'Six questions. Passing opens guided tailoring and application tools. AI limits still apply. Your application and interview work still need doing.',
  action: 'Start the check',
};
