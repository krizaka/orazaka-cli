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
