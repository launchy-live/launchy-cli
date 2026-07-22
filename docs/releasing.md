# Releasing

The package is published to npm as **`launchy-cli`** (unscoped, so
`npm install -g launchy-cli` works as documented in the README).

## One-time setup

1. **Create an npm account** at <https://www.npmjs.com/signup>. Verify the
   email, then enable 2FA (Account → Two-Factor Authentication). npm requires
   2FA to publish.
2. **Create an Automation token**: npm → Access Tokens → Generate New Token →
   *Automation*. Automation tokens bypass the interactive OTP prompt, which is
   what lets CI publish. Classic "Publish" tokens will fail in CI once 2FA is on.
3. **Add it to the repo**: Settings → Secrets and variables → Actions → New
   repository secret, named `NPM_TOKEN`.

## Cutting a release

```bash
npm version patch      # or minor / major — commits and tags vX.Y.Z
git push --follow-tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

Creating the release triggers `.github/workflows/publish.yml`, which runs the
full test suite, checks the tag matches `package.json`, and publishes with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements) —
a signed attestation linking the tarball to the exact commit and workflow that
built it. Consumers see a "Built and signed on GitHub Actions" badge on npm.

## Publishing from a laptop instead

```bash
npm login
npm publish --access public    # prompts for your 2FA code
```

`prepublishOnly` runs the tests first either way, so a broken build cannot ship.

## Version policy

The CLI's **output contract is its public API**: the `{data, pagination?}`
success envelope, the `{error: {code, message}}` error envelope, and exit codes
0-6. Agents and scripts depend on these. Changing any of them is a **major**
version bump. Adding commands, flags, or fields is a minor bump.
