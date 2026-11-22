# Releasing

Releases are published by a maintainer with [`np`](https://github.com/sindresorhus/np) (`npm run release`). There is no automated publish workflow.

The version in `package.json` is bumped **only** by the release step below. Don't bump it by hand in feature branches.

## Steps

1. **Merge** the release-ready changes into `main`, and confirm CI is green on `main`. That includes the `package-runtime` jobs, which test the packed tarball on Node 22.12.0, 22.x, 24.x, and 26.x.

2. **Update the changelog.** In `CHANGELOG.md`, replace `(unreleased)` with the release date, and commit that change to `main`.

3. **Check out a clean `main`:**

   ```bash
   git checkout main
   git pull
   git status # must be clean
   ```

4. **Release:**

   ```bash
   npm run release
   ```

   `np` reinstalls dependencies, runs the tests, bumps the version (choose the version listed in `CHANGELOG.md`), creates the version commit and tag, and publishes. Publishing runs the `prepublishOnly` (`npm run check`) and `prepare` (build) lifecycles. `np` then pushes the commit and tag and can open a draft GitHub Release.

5. **Verify the published package:**

   ```bash
   npm view @ensembleblock/airtable@<version>

   cd "$(mktemp -d)"
   npm pack @ensembleblock/airtable@<version>
   /path/to/repo/scripts/test-package.sh --tarball ./ensembleblock-airtable-<version>.tgz
   ```

## Versioning

The package is pre-1.0. Because npm's caret ranges (`^0.x.y`) treat a minor bump as breaking, bump the **minor** version for breaking changes and the **patch** version for everything else.
