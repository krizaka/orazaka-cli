# orazaka-cli — Governance scope (agent-neutral)

> This repository is one component of the **Orazaka platform**. The normative contract is
> [`AGENTS.md`](https://github.com/krizaka/orazaka/blob/main/AGENTS.md) at the root of the Orazaka workspace
> ([`krizaka/orazaka`](https://github.com/krizaka/orazaka)), together with its `.agent/rules/*`. When this repository
> is cloned inside the workspace (`orazaka-apps/ui/orazaka-cli`), that contract is loaded first and applies
> without exception. **No rule lives here** — this file only scopes it.

## Scope of this repository

- **Role:** The `orazaka` developer CLI: install, start, dev, test, docs and pack tooling for the Orazaka workspace, with an offline SQLite queue.
- **Layer:** Client application
- **Depends on:** nothing — never on another repository's Tier-3 implementation (AGENTS.md §2, [SEAM-002]).
- **Workspace path:** `orazaka-apps/ui/orazaka-cli`

## Definition of done

1. `npm run validate` (or `lint` + `build`) is green inside the workspace (`orazaka-apps/ui`).
2. No hard-coded colors, 250-line cap per component, types only from `@krizaka/orazaka-shared` (AGENTS.md §8).
3. The change ships with its tests — a unit test for logic, a render test for a component, an end-to-end test for a
   route or a flow; a fix starts with a failing test that reproduces the bug. CI runs them and must be green; no test =
   not done (workspace [`AGENTS.md` §9](https://github.com/krizaka/orazaka/blob/main/AGENTS.md#9-testing)).

## Release

The CLI is published to npm as **`@krizaka/orazaka-cli`** (canonical, bin `orazaka`) together with **`orazaka`**
(`alias/`, the unscoped short name behind `npx orazaka …`), which depends on the exact same version and only starts it.

1. Bump `version` in `package.json` **and** in `alias/package.json`, and the alias's `@krizaka/orazaka-cli`
   dependency to that same version (`npm run test:pack` fails when the three disagree). Pull request, green CI, squash.
2. From `main` up to date: `npm run test:pack`, then publish the CLI **before** the alias (the alias resolves it from
   the registry):

   ```bash
   npx npm@11 publish                 # @krizaka/orazaka-cli (prepack builds dist/)
   cd alias && npx npm@11 publish     # orazaka
   ```

   Trusted publishing (OIDC) is not configured for these packages yet, so they are published from a maintainer's
   machine (`npm whoami` → a member of the `krizaka` npm organisation); once it is, the `v*` tag publishes them.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`, then check `npm view @krizaka/orazaka-cli version` and
   `npm view orazaka version`, and `npx --yes orazaka@X.Y.Z --version` from an empty directory.

## Before you open or update a pull request (coding agents)

These are the defects code review found most often on 2026-10-23. Check them yourself before you open or update a pull request:
1. **Checks:** run the repository's full check (lint, typecheck, tests, build) and fix it. Never push a red check.
2. **Concurrency:** any « count then insert » or « check then write » runs in one transaction with a lock, and has a concurrency test.
3. **One gate:** a rule (limit, permission, validation) is enforced in the service, so no route can skip it. Test every route.
4. **Errors:** a cleanup (ROLLBACK, DROP, close) never masks the original error. Rethrow it, or throw an `AggregateError` with the original first.
5. **Validation:** validate the original input, never a truncated or pre-trimmed copy. Server and client reject the same inputs.
6. **Accessibility:**
   - every control has a unique label, and FR/EN pairs say their language;
   - focus rings are never clipped by `overflow`;
   - text never overflows its box at 360 px.
7. **Naming:** environment variables follow `<CONTEXT>_<THING>` (`APP_`, `DATABASE_`, `AUTH_`, `MEDIA_`, `MAIL_`, `PAYMENTS_`, `AI_`…) and are declared once.
8. **Words:** every user-facing string is in the FR and EN messages, and no colour is hard-coded.
9. **Review threads:** answer every one. Fix it test-first, or reply with the reason, then resolve it.
