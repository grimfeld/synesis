# Shipping

How work gets from a branch to main in this repository. Written by `/ship:setup-ship`; the
`ship` plugin's skills (`pr-review`, `night-shift`) read it. Keep it true when the process changes.

## The rule

A PR reaches `main` only after a person has reviewed it and added the **`ship`** label.
Nothing else merges: the `ship` commit status is required by the ruleset on `main`, and it stays
pending until the label is on.

The label approves a PR; it doesn't land it. Landing is a separate step, so a morning's batch can be approved PR by
PR and then land as one.

1. An agent opens the PR as a **draft** while it works.
2. It marks the PR ready only when local checks pass, `/ship:pr-review` has run (label `pr-reviewed`) and the
   review section is in the description.
3. You read the review section, and approve it (`ship`) or leave a comment. `/ship:land <pr>...` does both
   for a batch: it adds `ship` to the PRs you name and sends the commented ones back for a rebuild.
4. Landing starts: `/ship:land` dispatches `.github/workflows/ship.yml`. It lands every labelled PR
   that targets `main`: GitHub auto-merge merges it, with a merge commit, once the required checks pass.

Dependabot patch updates and GitHub Actions updates get `ship` and land without review.

## What the label approves

The label approves the PR, not a commit: it stays on through later pushes, and those land with it unreviewed. That
includes the stacked-PR cascade's merge of `main` and any `/ship:resolve-conflicts` fix. So:
- Don't add `ship` while someone may still push to the PR.
- Remove `ship` before pushing more work to an approved PR, and review again before adding it back.

Removing `ship` also turns off GitHub auto-merge if a landing run turned it on, so adding the label back lands
nothing until the next landing run.

## Stacked PRs

A PR built on top of another one targets that PR's branch, not `main`. It can carry `ship`, but nothing
lands it while its base is another branch: approving it means "ship it once its parent is in".

When a PR merges, the `queue` job in `ship.yml` takes each PR stacked on it:

1. retargets it to `main` (GitHub does this itself when the merged branch is deleted)
2. merges `main` into it, never a rebase, and pushes, so its CI runs again
3. lands it if it carries `ship` (auto-merge mode: in the same run, once its CI passes; command mode: with the next
   scheduled run), or takes it out of the queue if the merge conflicts (see below)

A merge lands only the children it moved; every other approved PR waits for the next landing run.

PRs stacked further up wait for their own parent. The cascade runs on PRs that close as merged: a PR closed
without merging leaves its children where they are.

## Landing

- **Mode:** auto-merge
- **Merge method:** merge

Merged by GitHub auto-merge when the required checks pass.

## Conflicts

A labelled PR that conflicts with `main` can't land: a landing run would skip it again and again.
The `queue` job in `ship.yml` checks the labelled PRs that target `main` each time it moves, before each
landing run, and after moving a merged PR's stacked children.
For each one that conflicts, it removes `ship`, adds **`conflicts`**, and comments with the conflicting files.

`/ship:resolve-conflicts [<pr>...]` merges `main` into each such PR, keeping what both sides meant, runs
the local checks and pushes. Then:

- **Only bookkeeping files conflicted:** `ship` goes back on, and the PR lands with the next landing run.
- **Anything else conflicted:** the resolution is new code. `/ship:pr-review` runs on it and a comment explains each
  choice; re-review it and add `ship` again.
- **The two sides contradict each other:** nothing is pushed, `conflicts` stays, and a comment names the decision to make.

Resolving it yourself works too: merge `main` into the branch, push, remove `conflicts` and add `ship`.

Bookkeeping files (a conflict here needs no re-review):

- `CONTEXT.md`
- `docs/PLAN.md`
- `CLAUDE.md`

## Checks

Required on `main`: `Typecheck, tests, fmt, clippy, Tauri build check` (CI), and `ship`.

Run locally before marking a PR ready: `npm run check` (typecheck, unit tests, clippy with `-D warnings`), plus `cargo test -p engine` and the Cypress spec of any UI feature touched (`npx cypress run --spec cypress/e2e/<spec>.cy.ts`, with `npm run tauri dev` running).

## After merge

Vercel deploys `main` to production: the web test build (`vercel.json`, project `synesis`) and the landing page (`site/vercel.json`, project `synesis-site`). App releases are not deployed on merge: they start by hand with `npm run release -- X.Y.Z` from a clean `main`, which commits the version bump and pushes it straight to `main`. The repository's Admin role may bypass the ruleset for that push.

## Screens

Command that produces screenshots of the screens a change touches, for the review section: `node scripts/ui-smoke.mjs '<json steps>'` (screenshots and console errors, with `npm run tauri dev` running); `node scripts/site-screenshots.mjs` for the landing page.

## Spec labels

Specs are GitHub issues moving through `spec:draft` → `spec:ready` → `spec:building` → `spec:in-review`, or
`spec:stuck`, and close when their PR ships. A PR you commented on instead of approving gets
**`changes-requested`**, and its spec goes back to `spec:ready` for the next night shift.

## Design labels

A design is a GitHub issue carrying a Claude Design artifact link. Label it `design:ready` when the design is
settled; `/ship:design-me` turns it into specs and relabels it `design:specced`. Its handoffs are committed under
`docs/design/<module>/` by the PRs that build them. To revise a design, relabel its issue `design:ready`.
