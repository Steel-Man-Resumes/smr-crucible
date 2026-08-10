# Indeed job-search access -- partner inquiry (go / no-go)

Phase 3.5, Refinery final plan. This is a DRAFT for Troy to route. Nothing is sent
autonomously (drafts-only rule). Never scrape Indeed -- this is a partner-access question only.

## The situation, plainly

Indeed does not offer a public job-seeker SEARCH API. Their public API surface
(the Employer / ATS "Job Sync" and Apply APIs, and the older Publisher program)
is for POSTING jobs and receiving applications, not for a job-seeker app to query
listings. So "add Indeed as a search provider like JSearch" is a partner-access
question, not a keys-and-code task. The realistic answers are:

- YES (partnered): Indeed grants a specific data/partnership agreement -- rare, and
  usually for established distribution partners.
- NO / use aggregators: Indeed listings reach us only through licensed aggregators
  (which is effectively what JSearch already blends), not a direct Indeed feed.

We proceed on the multi-board plan regardless (Adzuna, USAJOBS, Jooble, repaired
CareerOneStop) so the product does not depend on Indeed's answer.

## Correct channel (verify before sending)

There is no reliable cold-email address for this. Route it through Indeed's own
partner/API request forms, not a guessed inbox:

- Indeed Employer / API partnerships: https://developer.indeed.com/ (partner request)
- Indeed publisher/partnership contact form on indeed.com/publisher or the
  "Partner with Indeed" pages.

Confirm the current live URL before submitting -- Indeed reorganizes these pages.

## Draft inquiry text (paste into their form / partner email)

Subject: API / data partnership inquiry -- reentry-focused career platform

Hello,

I run Steel Man Resumes, a career-intelligence platform that helps justice-impacted
job seekers build strong resumes and find fair-chance employers. We currently surface
openings to our users through licensed providers and would like to understand whether
Indeed offers any job-seeker search or data partnership we could license to show
Indeed listings inside our tool.

Specifically:
1. Is there a job-seeker search or job-data API available under a partnership or
   license agreement (not the employer/ATS posting APIs)?
2. If not a direct feed, what is the sanctioned way for a platform like ours to
   surface Indeed listings to users (for example, through an approved aggregator)?
3. What are the volume, attribution, and apply-flow requirements?

We do not scrape and are looking only for a sanctioned, licensed path. Happy to share
more about our nonprofit-adjacent reentry mission and traffic profile.

Thank you,
Troy Carr
Steel Man Resumes
troyrichardcarr@gmail.com

## Recommendation

Treat Indeed as go/no-go only. Do not block any Refinery work on it. The per-provider
apply-link quality ranking (Phase 3.5d, shipped) already prefers real employer/ATS
links over aggregator hops, so however Indeed listings arrive, the honest-destination
labeling handles them.
