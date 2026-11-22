# Releasing

Releases are published to npm by GitHub Actions ([`.github/workflows/release.yml`](./.github/workflows/release.yml)) using **npm trusted publishing**. GitHub's OIDC token is exchanged for a short-lived publish credential. **No npm token exists in this repo, in GitHub secrets, or on a maintainer's machine.** Every release gets an npm [provenance attestation](https://docs.npmjs.com/generating-provenance-statements) linking it to the exact commit and workflow run.

Publishing is **staged**: the workflow can only _stage_ a version. It goes live only after a maintainer approves it with npm 2FA. A compromised GitHub account, workflow, or dependency can't publish on its own.

## Overview

| #   | Who            | What                                                                                                 |
| --- | -------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | You            | PR: bump the version and date the changelog. Merge when CI is green.                                 |
| 2   | You            | Push an annotated tag `vX.Y.Z` on `main`.                                                            |
| 3   | GitHub Actions | Verify, test, pack, smoke-test, **stage** the tarball on npm, and create a **draft** GitHub Release. |
| 4   | You            | Review and approve the staged version with 2FA (`npm stage approve`). It's now live on npm.          |
| 5   | You            | Publish the draft GitHub Release.                                                                    |

## Versioning

The package is pre-1.0. npm's caret ranges treat a `0.x` minor bump as breaking (`^0.1.0` won't pick up `0.2.0`), so:

- **Breaking change**: bump the **minor** (`0.1.3` → `0.2.0`).
- **Anything else** (features, fixes): bump the **patch** (`0.1.3` → `0.1.4`).

Every change since the last release should be listed under `## X.Y.Z (unreleased)` in `CHANGELOG.md`. The version in `package.json` changes **only** in the release PR (step 1).

## Releasing a version

### 1. Release PR

```bash
git switch main && git pull --ff-only
git switch -c release/vX.Y.Z

npm version X.Y.Z --no-git-tag-version   # updates package.json & package-lock.json
```

In `CHANGELOG.md`, change `## X.Y.Z (unreleased)` to `## X.Y.Z (YYYY-MM-DD)`, using the date you'll release. The workflow refuses to release without a dated heading, and the section under it becomes the GitHub Release notes.

```bash
npm run check
npm run test:package
git commit -am "vX.Y.Z"
git push -u origin release/vX.Y.Z
gh pr create --fill
```

Merge once CI is green.

### 2. Tag

```bash
git switch main && git pull --ff-only
git status                     # must be clean
node -p 'require("./package.json").version'   # must print X.Y.Z

git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

Push **only that tag**. Never run `git push --tags` or `--follow-tags`: old local tags from the `np` era conflict with the tags on GitHub (see [Historical tags](#historical-tags)).

### 3. GitHub Actions

Watch the run with `gh run watch` (or under the repo's **Actions → Release** tab). The workflow:

1. **Verify, test & pack** (`contents: read`):
   - Fails unless the tag equals `v` + the `package.json` version.
   - Fails unless the tagged commit is on `main`.
   - Fails if the version is already on npm.
   - Fails if `CHANGELOG.md` has no dated heading for the version.
   - Runs `npm ci` and `npm run check`, packs, and runs `scripts/test-package.sh` on the tarball.
   - Extracts the release notes.
2. **Stage on npm** (`id-token: write`, environment `npm`):
   - Runs `npm stage publish <tarball>` on the tarball tested in step 1.
   - This job checks out nothing and installs nothing.
   - The job summary shows the stage ID.
3. **Draft GitHub Release** (`contents: write`): creates a draft release for the tag, with notes from `CHANGELOG.md`.

### 4. Approve on npm

You need an npm login session with 2FA. Trusted publishing can't approve, by design.

```bash
npm login                                  # if `npm whoami` fails
npm stage list @ensembleblock/airtable     # find the stage ID
npm stage view <stage-id>                  # check version & files
npm stage download <stage-id>              # optional: inspect the tarball
npm stage approve <stage-id>               # 2FA prompt; the version is now live
```

You can also do this on npmjs.com, on the package's **Staged Packages** tab.

If something's wrong, `npm stage reject <stage-id>`, then see [Recovery](#recovery).

### 5. Publish the GitHub Release

```bash
gh release edit vX.Y.Z --draft=false
```

### 6. Verify

```bash
npm view @ensembleblock/airtable@X.Y.Z version dist.attestations.provenance
npm view @ensembleblock/airtable dist-tags   # latest should be X.Y.Z
gh release view vX.Y.Z

# Provenance & registry signatures, as a consumer would check them:
cd "$(mktemp -d)" && npm init -y > /dev/null \
  && npm install @ensembleblock/airtable@X.Y.Z && npm audit signatures

# Smoke-test the published tarball:
cd "$(mktemp -d)" && npm pack @ensembleblock/airtable@X.Y.Z
/path/to/repo/scripts/test-package.sh --tarball ./ensembleblock-airtable-X.Y.Z.tgz
```

On npmjs.com, the version page should show a **Provenance** section that links to the commit and the Release workflow run.

## Troubleshooting

| Symptom                                                               | Cause / fix                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow didn't start                                                 | The tag must match `v*.*.*` and be pushed to GitHub (`git ls-remote --tags origin`).                                                                                                                                                                                                                                        |
| "Tag … does not match package.json version"                           | You tagged the wrong commit, or the release PR wasn't merged. Delete the tag (see Recovery) and retag.                                                                                                                                                                                                                      |
| "Tagged commit … is not on main"                                      | Tag a commit on `main`, not on a branch.                                                                                                                                                                                                                                                                                    |
| Stage job waits on, or is rejected by, the `npm` environment          | The environment only allows `v*` tags. Check **Settings → Environments → npm**.                                                                                                                                                                                                                                             |
| `npm stage publish` fails with 401/403/404 (`ENEEDAUTH`, OIDC errors) | The trusted publisher config on npmjs.com must exactly match (case-sensitive): org `ensembleblock`, repo `airtable`, workflow `release.yml`, environment `npm`. `package.json` `repository.url` must point at this repo. A new or re-created config expires if unused for 2 days. Re-create it, then re-run the failed job. |
| "npm >= 11.15.0 is required"                                          | Node 24.x's bundled npm got older? Raise `node-version` in `release.yml`.                                                                                                                                                                                                                                                   |
| Draft release step failed                                             | Re-run that job. It skips if the release already exists.                                                                                                                                                                                                                                                                    |

Use **Re-run failed jobs**, not **Re-run all jobs**. The stage job has no way to see an earlier stage that's still pending, so re-running it stages a second copy. That's harmless, but reject the extra one.

## Recovery

| Situation                                                  | What to do                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed **before** staging (nothing on npm)                 | Fix the problem on `main` via PR, then move the tag: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`, then tag and push again. The tag ruleset requires you to be a repo admin for this. Delete any draft release for the tag first. |
| Staged, but you found a problem before approving           | `npm stage reject <stage-id>`. Delete the draft release (`gh release delete vX.Y.Z`) and the tag (as above), fix, and release again. The version number was never published, so it can be reused.                                             |
| Approved (live on npm), but the GitHub Release step failed | Re-run the failed job, or create it by hand: `gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes-file <notes>`.                                                                                                                     |
| A broken version is **live** on npm                        | npm versions can't be reused. Deprecate it and release a patch: `npm deprecate @ensembleblock/airtable@X.Y.Z "Broken; use X.Y.(Z+1)"`. Unpublishing is heavily restricted (generally only within 72 hours) and is a last resort.              |

## One-time setup

Already done for this repo. Listed here so it can be checked or rebuilt.

### npm (npmjs.com, as a package owner)

1. **2FA** on the account (Account → Two-Factor Authentication). Approving a stage always prompts for 2FA.
2. **Trusted publisher**: package page → **Settings** → **Trusted publishing** → **GitHub Actions**:
   - Organization or user: `ensembleblock`
   - Repository: `airtable`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
   - Allowed actions: `npm stage publish` only. Leave `npm publish` and `npm dist-tag` **unchecked**.

   A new configuration expires if it's not used within 2 days, so create it shortly before tagging. Configurations can't be edited; delete and re-create them instead.

3. **Publishing access**: package **Settings** → **Publishing access** → "Require two-factor authentication and disallow tokens". Trusted publishing is unaffected.
4. **No tokens**: under **Access Tokens**, revoke any token that can publish this package. Your local `~/.npmrc` shouldn't hold a registry.npmjs.org `_authToken` beyond your `npm login` session.

### GitHub (repo **Settings**)

1. **Actions → General → Workflow permissions**: "Read repository contents and packages permissions". Uncheck "Allow GitHub Actions to create and approve pull requests". The release workflow declares what each job needs.
2. **Environments → `npm`**: **Deployment branches and tags** → "Selected branches and tags" → add a rule with ref type **Tag** and pattern `v*`. No required reviewers: npm stage approval is the human gate.
3. **Rules → Rulesets → New tag ruleset** (name: `release tags`):
   - Enforcement: Active.
   - Target: tags matching `v*`.
   - Rules: Restrict updates, Restrict deletions, Block force pushes.
   - Bypass list: Repository admin.
4. **General → Releases → Enable release immutability**. Once a release is published, its tag can't be moved or reused. Drafts stay editable, so this fits step 5.

## Historical tags

Before 0.1.0, releases used [`np`](https://github.com/sindresorhus/np), and the tags didn't line up:

- `np`'s annotated tags `v0.0.1`–`v0.0.11` were created locally and **never pushed**.
- The `v0.0.1`–`v0.0.9` tags on GitHub were created by the GitHub Releases UI. Each one points at the commit **before** that version's version-bump commit.
- `v0.0.7`, `v0.0.10`, and `v0.0.11` have no GitHub tag or release.
- The npm tarballs' `gitHead` values are on `main`.

From 0.1.0 on, the tag that triggers the workflow is the release tag, so npm, Git, and GitHub Releases agree.
