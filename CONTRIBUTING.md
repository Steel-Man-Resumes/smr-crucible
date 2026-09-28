# Contributing

Thank you for your interest. This project exists to help justice-impacted people find
work, and contributions are welcome under that shared goal.

## Ground rules (non-negotiable)

- **Language.** Never label a person: say "if you have a felony," never "you are a felon."
  On job-seeker surfaces, the searcher's own words ("felony," "jobs for felons,"
  "second chance jobs") are allowed so people can find us. "Justice-impacted" and
  "fair-chance" are practitioner words for buyer and funder pages. Never "ex-offender,"
  "ex-con" or "convict." These rules protect the dignity of the people we serve.
- **No legal advice.** Features inform and help people decide; they never give legal
  advice. Keep that boundary in copy and behavior.
- **Privacy first.** Conversation text (disclosure rehearsal, interview practice) is
  stored only through `packages/core/src/conversationStore.ts`: text only, encrypted in
  the app, never audio. Do not add another path that stores what a person said.
  Sensitive data is consent-gated and minimized.
- **Public repository.** This repository is public. Working notes, credentials, access codes and the names of partners, leads or participants never go in it.
  Maintainer session notes are kept in a private record outside this repo
  (`~/todash/smr/crucible-handoff/HANDOFF.md` on the maintainer's machine). Use
  placeholders such as `<ACCESS_CODE>` and roles instead of names in docs, comments,
  commit messages and PR descriptions. CI runs `scripts/lint-no-secrets-in-docs.mjs`
  and fails on credential-shaped lines in docs or a root `HANDOFF.md`.
- **Style.** Plain language, sixth-grade reading level in user-facing copy. No em
  dashes. No emojis in product or professional content.

## Workflow

1. Open an issue describing the change before large work.
2. Branch from `main`. Keep commits atomic with clear messages.
3. Run type checks and any tests before opening a PR:
   ```bash
   npm run build -w packages/core
   npx tsc --noEmit -p apps/consumer/tsconfig.json
   ```
4. Never commit secrets. `.env.local` is gitignored; use `.env.example` for new keys.
5. Verify behavior against a real database or a running app, not just a successful
   build. "It compiled" is not "it works."

## License of contributions

By contributing, you agree your code is licensed under AGPL-3.0-or-later and your
documentation under CC BY 4.0, consistent with this repository.
