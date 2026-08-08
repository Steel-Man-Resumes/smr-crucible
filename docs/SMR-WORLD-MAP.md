# Canonical SMR World Map

**Artifact:** [`SMR-WORLD-MAP.html`](./SMR-WORLD-MAP.html)  
**Created:** August 8, 2026  
**Initial author:** OpenAI Codex, at Troy Carr's request

## What this is

This is the human-facing product map for the complete Steel Man Resumes world:

1. **The Site** -- the public explanation, product tours, resource library,
   evidence, trust, partner, and contact routes.
2. **The Forge** -- audience selection, the complete personal intake, resume
   branches, analysis, outputs, walkthrough, and supporting paths.
3. **The Refinery** -- access, onboarding, job search, applications, career-package
   tailoring, disclosure, interview practice, saved materials, progress,
   organization views, evidence, and administration.

It is designed for ordinary people first. It may be used during demonstrations,
embedded or adapted for the SMR website, used for onboarding, or referenced during
product planning.

The initial version was produced after auditing the live route and product
structures in:

- `~/repos/smr-website/src/app/**`
- `apps/consumer/app/**`
- `apps/consumer/components/**`
- the Forge and Refinery navigation shells
- the public guide and printable-download registries

## How to use it

Open `docs/SMR-WORLD-MAP.html` directly in Chrome, Edge, or another modern browser.
It is self-contained and has no build step or network dependency.

- Switch between **The Site**, **The Forge**, and **The Refinery**.
- Use **Main journey** for the simplest recording view.
- Use **Expand all** when auditing completeness.
- Search within the active world by page, tool, route, outcome, or idea.
- Only rows with arrows are expandable. Document-shaped rows are terminal items.

## Canon and maintenance rule

This file is the canonical **human-readable description** of the product as of its
snapshot date. Runtime code remains the execution source of truth.

Update the world map whenever any of these change materially:

- a public SMR page, guide category, guide, or printable;
- the Forge route order, intake choices, resume branches, or report outputs;
- Refinery navigation, onboarding gates, tools, saved artifact types, or progress
  stages;
- Mini Forge or Coming Home handoffs;
- partner, organization-admin, staff, observer, or internal-admin permissions;
- the product design system or names used for human-facing features.

If the map and runtime behavior disagree, treat the runtime route and current
product doctrine as authoritative, then update this map in the same change.

## Original working copy

The standalone working copy created during the design session remains at:

`/home/marcu/smr-demo-journey-map/index.html`

The repository copy is the version future SMR work should reference and maintain.
