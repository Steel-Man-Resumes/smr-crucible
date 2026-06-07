# Contributing

Thank you for your interest. This project exists to help justice-impacted people find
work, and contributions are welcome under that shared goal.

## Ground rules (non-negotiable)

- **Language.** Always "justice-impacted," never "ex-offender," "felon," "convict," or
  "second-chance." Use "fair-chance," not "second-chance." These reflect the dignity of
  the people we serve.
- **No legal advice.** Features inform and help people decide; they never give legal
  advice. Keep that boundary in copy and behavior.
- **Privacy first.** Do not add anything that stores a person's practice answers,
  interview transcripts, audio, or disclosure wording. We store progress and frames,
  not content. Sensitive data is consent-gated and minimized.
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
