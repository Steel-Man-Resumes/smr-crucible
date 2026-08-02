# Forge + Refinery Full Redesign Handoff

**Date:** 2026-08-01  
**Prepared for:** Claude Code (CC)  
**Repository:** `/home/marcu/repos/smr-crucible`  
**Application:** `apps/consumer`  
**Production project:** Vercel `troy-carrs-projects/the-crucible`

## Read This First

The Forge and The Refinery have been redesigned across the complete consumer app and deployed live. The redesign is intentionally part of the Steel Man Resumes family without copying the more expressive Steel Man Resumes marketing site. It is quieter, more institutional-neutral, and suitable for co-branded partner use.

**Critical repository state:** the production deployment was created directly from the current working tree. The redesign is not committed or pushed as of this handoff. Do not deploy an older `main` revision over production. Review the working tree, preserve all current changes, then commit and push intentionally.

Current diff summary before this handoff file:

```text
84 files changed, 954 insertions, 1936 deletions
```

The working tree also contains new, untracked shell, brand, and asset files. Run `git status --short` before doing anything.

## Production Status

Production deploy completed successfully:

- Deployment ID: `dpl_9yB4qFYKwZPecjxBJYXwsasS8FbW`
- Deployment URL: `https://the-crucible-cqafj7mtq-troy-carrs-projects.vercel.app`
- Created: 2026-08-01 at 19:42 CDT
- Vercel status: `Ready`
- Forge alias: `https://forge.steelmanresumes.com`
- Refinery alias: `https://refinery.steelmanresumes.com`

The CLI production deployment did not initially move the custom aliases. They were explicitly assigned with:

```bash
vercel alias set the-crucible-cqafj7mtq-troy-carrs-projects.vercel.app forge.steelmanresumes.com
vercel alias set the-crucible-cqafj7mtq-troy-carrs-projects.vercel.app refinery.steelmanresumes.com
```

Live smoke checks passed:

- `forge.steelmanresumes.com` redirects to `/intro`, final response `200`
- `forge.steelmanresumes.com/intro` returns `200`
- Forge lockup and icon assets return `200`
- `refinery.steelmanresumes.com` redirects to `/login`, final response `200`
- `refinery.steelmanresumes.com/login` returns `200`
- Refinery lockup and icon assets return `200`

Final Chromium screenshots were also taken directly against the two custom domains at a 390x844 viewport. Both live headers displayed the Steel Man parent mark and the correct final product lockup without overlap.

## Product Direction

The approved design direction is:

- Forge and Refinery clearly belong to Steel Man Resumes.
- Forge and Refinery match each other structurally.
- Forge uses a muted forged-gold accent; Refinery uses a muted sage accent.
- The surrounding experience is calm, utilitarian, readable, and interchangeable across partner organizations.
- Expressive workshop/terminal styling is reserved for direct input, command context, and small typographic signals.
- The terminal cursor/input feel is a deliberate product feature and should be preserved.
- Steel Man Resumes remains visible as the parent brand.
- Co-branding is visible as a supported feature even before a real partner identity is configured.
- Avoid bringing back full-screen dark-terminal styling, scanlines, distressed decoration, or ornate workshop visuals throughout the general app shell.

## Design System

The primary design tokens live in:

- `apps/consumer/app/terminal.css`
- `apps/consumer/app/globals.css`
- `apps/consumer/tailwind.config.ts`
- `packages/consumer-ui/src/theme.ts`

Core palette:

```text
Application background  #eaede9
Panels                  #ffffff / #f5f6f4 / #e4e8e3
Primary text            #1c1e1b
Secondary text          #5f665f / #6d736d
Borders                 #d3d8d1 / #aeb5ad
Forge accent            #9b6d1d (hover #795212)
Refinery accent         #4f6b57 (hover #3d5745)
Terminal field          #10110f
Terminal input text     #a7cf98
Terminal cursor/prompt  #d7b86e
```

Typography:

- UI/body: IBM Plex Sans Variable
- Terminal/input/context: IBM Plex Mono
- Font packages are imported in `apps/consumer/app/layout.tsx`.
- New dependencies: `@fontsource-variable/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, and `lucide-react`.

Form behavior:

- Standard text inputs and textareas receive dark terminal treatment globally in `globals.css`.
- They use IBM Plex Mono, a gold `$` prompt, sage text, and gold caret.
- Selects remain conventional light controls.
- Checkbox/radio/range/file/button inputs are excluded from the global terminal selector.
- `.terminal-field` is available for components that provide their own prompt wrapper.
- Focus rings are 3px and reduced-motion behavior is defined globally.

UI rules established by this pass:

- Panels/cards use restrained borders, 4-7px radii, and low shadows.
- Lucide icons replace manually drawn action SVGs where practical.
- Minimum interactive height is 44px.
- The main application is light; terminal treatment is contextual rather than the whole canvas.

## Shared Branding Architecture

Central brand component:

```text
apps/consumer/components/brand/BrandMarks.tsx
```

Exports:

- `SteelManBrand`
- `ProductBrand`
- `ProductFamilyBrand`
- `CoBrandLockup`

`ProductFamilyBrand` displays Steel Man Resumes as the parent identity, a divider, and the appropriate Forge or Refinery lockup. On small screens, the Steel Man parent identity compacts to the mark while the product lockup remains visible.

The product PNG lockups are intended for light surfaces. Their typography and human figure are black and will disappear on black/dark backgrounds. Create an approved inverse asset before using them on a dark surface.

Partner co-brand configuration is in:

```text
apps/consumer/lib/tenant-config.ts
```

Supported public environment variables:

```text
NEXT_PUBLIC_PARTNER_NAME
NEXT_PUBLIC_PARTNER_DESCRIPTOR
NEXT_PUBLIC_PARTNER_LOGO_PATH
NEXT_PUBLIC_PARTNER_COLOR
```

Without those variables, the UI deliberately shows the fabricated placeholder `Your Organization`, an `ORG` tile, and `Powered by Steel Man Resumes`. This demonstrates co-branding as an available product feature.

## Final Logo Assets

User-supplied originals are outside the repository:

```text
C:\Users\marcu\Dev\SMR Master Folder\04-logos-and-assets\forge and refinery\forge-icon.png
C:\Users\marcu\Dev\SMR Master Folder\04-logos-and-assets\forge and refinery\forge-lockup.png
C:\Users\marcu\Dev\SMR Master Folder\04-logos-and-assets\forge and refinery\refinery-icon.png
C:\Users\marcu\Dev\SMR Master Folder\04-logos-and-assets\forge and refinery\refinery-lockup.png
```

WSL source directory:

```text
/mnt/c/Users/marcu/Dev/SMR Master Folder/04-logos-and-assets/forge and refinery
```

All originals were 1728x2304 RGBA PNGs with very large transparent canvases. They were alpha-bounds cropped, given a small transparent safety margin, and Lanczos resized with FFmpeg. The original files were not modified.

Web assets:

```text
apps/consumer/public/brand/forge-icon.png       512x512
apps/consumer/public/brand/forge-lockup.png     1200x572
apps/consumer/public/brand/refinery-icon.png    512x512
apps/consumer/public/brand/refinery-lockup.png  1200x496
```

The square icons are used for favicons/metadata. The lockups are used in visible product branding. Earlier provisional SVG assets (`forge-mark.svg`, `refinery-mark.svg`, and provisional lockup SVGs) remain in the directory but have no active app/component references. They may be removed later after confirming no external consumer depends on their URLs.

Route metadata mapping:

- Forge icon: `(forge)` and `(mini-forge)` layouts
- Refinery icon: `(dashboard)`, `(auth)`, `/access`, and `/walkthrough` layouts
- Root product launcher retains the general Steel Man Resumes favicon metadata

## Shell and Navigation Changes

Forge client shell:

```text
apps/consumer/app/(forge)/ForgeShell.tsx
```

The old client-heavy route layout was extracted into this shell so the route layout can export product metadata. It retains Forge context, progress, assistant context, and the gated contact action. It adds the shared product-family header, privacy message, and clear icon-led exit control.

Refinery client shell:

```text
apps/consumer/app/(dashboard)/RefineryShell.tsx
```

The previous large dashboard layout was moved into this client shell so the route layout can export metadata. Existing auth, tier gating, onboarding behavior, nav rules, assistant context, progress banners, and mobile drawer behavior remain. The visual shell is now quiet and work-focused, with the Refinery sage state applied through `.refinery-app`.

Important: preserve the server-layout/client-shell split if metadata or providers are changed. Do not move `"use client"` back into the route layouts unless there is a strong reason.

## Public and Authenticated Surface Coverage

The redesign includes:

- New root workspace chooser at `/`
- Forge entry and full Forge workflow surfaces
- Refinery login, registration, forgot/reset/check-email states
- Shared access-code page and partner presentation
- Mini Forge shell and result states
- Full authenticated Refinery navigation and dashboard tools
- Admin, health, partner, settings, materials, evidence, jobs, employers, resources, progress, applications, disclosure, interview, and application-tailor surfaces
- Guided walkthrough and walkthrough screens
- Shared assistant, progress, card, flow, input, textarea, prompt, terminal panel, and action components
- Public/security/supporting surfaces inheriting the shared tokens

The approach combined global token/component changes with targeted page corrections. Do not assess coverage only by looking for bespoke page rewrites; many pages were intentionally normalized through shared tokens and shared UI components.

## Key Behavior Preserved

This was a presentation and interaction-system redesign, not a domain rewrite. Existing core behavior remains in place:

- Forge local/session context and six-step progression
- Resume parsing/building/output flow
- Auth.js authentication and callbacks
- Refinery tier and onboarding gates
- Dashboard route gating and mobile navigation
- Assistant and coach contexts
- Artifact, application, disclosure, interview, employer, resource, partner, and admin data flows

No database migrations, API-contract changes, worker deployments, or production environment-variable changes were part of this redesign.

## Validation Completed

Production build:

```bash
npm run build -w apps/consumer
```

Result:

- `packages/core` TypeScript build passed
- Next.js optimized production build passed
- Lint/type validation passed
- 97 static/dynamic routes generated successfully

The Vercel build also completed successfully. It emitted two pre-existing operational warnings that were not introduced or changed by this redesign:

- `bcryptjs` imports Node `crypto`/`setImmediate` through `auth.ts`, which Next warns about in the Edge middleware bundle.
- Vercel's clean `npm install` reported 19 dependency advisories: 5 low, 4 moderate, 8 high, and 2 critical. No forced audit upgrade was attempted because that can introduce breaking dependency changes; review with `npm audit` as a separate security task.

Additional validation:

```bash
cd apps/consumer
npx tsc --noEmit
```

Result: zero errors.

Visual checks were completed with Chromium at 1440px desktop and 390px mobile for:

- Root product launcher
- Forge `/welcome`
- Refinery `/login`

The final lockups fit without collision in desktop and mobile headers. A broader route smoke pass during the redesign covered 44 interfaces at mobile width.

## Local Development Note

The consumer package defaults to port `3002`, but another local process was already using that port during this work. Port `3003` was used instead:

```bash
cd /home/marcu/repos/smr-crucible/apps/consumer
npx next dev --port 3003
```

The local server was stopped before the final production build. A transient 404 seen during hot reload was cleared by a clean dev-server restart; after restart `/`, `/welcome`, and `/login` all returned `200`.

## Recommended CC Next Steps

1. Read `AGENTS.md`, `CLAUDE.md`, and this handoff before editing.
2. Inspect `git status --short` and `git diff --stat`; do not discard the current working tree.
3. Review the redesign diff, especially global input styling and the two extracted shells.
4. Commit the complete redesign and final brand assets intentionally so source control matches production.
5. Push only after confirming the branch and Vercel git integration will not replace production with an older revision.
6. Run a logged-in browser pass for tier-specific dashboard states if test credentials are available.
7. Replace the fabricated co-brand placeholder only when a real partner name/logo/color set is approved.
8. Remove provisional SVG marks only after verifying no external URL consumers exist.

## Do Not Regress

- Do not remove Steel Man Resumes parent branding from Forge/Refinery headers.
- Do not turn the entire experience back into a dark terminal UI.
- Do not remove the terminal feel from direct text entry without explicit approval.
- Do not use the black-text product lockups on dark backgrounds.
- Do not remove the co-branding placeholder; it is intentional product signaling.
- Do not deploy the old `main` state over the current direct production deployment.
- Preserve all existing justice-impacted language, privacy, and resume-content safeguards in `AGENTS.md`.
