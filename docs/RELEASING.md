# Releasing Picvert

Step-by-step for cutting a new release that auto-updates installed users.

## One-time setup (already done — recorded here for reference)

### 1. GitHub repository secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | What | Where it lives locally |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Full content of the minisign private key file (the file is itself a one-line base64 string). | `~/Documents/.picvert-signing-backup/picvert-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password set when running `tauri signer generate`. Currently **empty** (we generated without `--password`). | — |
| `APPLE_CERTIFICATE` | Base64 of the Developer ID Application `.p12` file. Get with `base64 -i picvert-cert.p12 \| pbcopy`. | `~/Documents/.picvert-signing-backup/picvert-cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password set when exporting the `.p12`. | — |
| `APPLE_ID` | Apple ID email (the one tied to the Developer Program). | — |
| `APPLE_PASSWORD` | App-specific password generated at <https://account.apple.com/account/manage>, **not** the regular Apple ID password. | — |
| `APPLE_TEAM_ID` | The 10-character team ID from your Developer membership. | — |

⚠️ `APPLE_SIGNING_IDENTITY` is **not** a secret in this workflow — the CI step extracts the SHA-1 of the Developer ID Application identity from the keychain after importing the `.p12` and writes it to `$GITHUB_ENV`. This avoids the "secret value has a trailing newline" trap that nukes codesign with `no identity found`.

The public counterpart of `TAURI_SIGNING_PRIVATE_KEY` lives in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). When users install the resulting `.app`, the updater plugin uses this embedded key to verify any update payload — so you cannot rotate the private key without forcing a manual reinstall of every existing user.

### 2. PyInstaller / Tauri framework quirks (already wired into release.yml)

The workflow does several non-obvious things to make Apple's notarization service accept a PyInstaller-bundled Python framework. They're documented in the YAML, but the gist:

1. **`install_name_tool -id`** on every framework's main binary — PyInstaller rewrites it to `@rpath/Python` which notarytool's structural check rejects.
2. **`codesign --remove-signature`** on every Mach-O after the install_name fix — strips PyInstaller's ad-hoc "Python-<random>" identifier so our `--force` re-sign doesn't inherit it.
3. **Replace `_internal/Python` symlink with a hard copy**, **delete `Python.framework/Python` outer symlink** — notarytool walks symlinks and evaluates each resolved path as a standalone binary, where the framework's signature doesn't apply.
4. **Three-pass inside-out signing**: loose Mach-O → each `*.framework/Versions/X` directory (generates `_CodeSignature/` *inside* the version) → each `*.framework` outer.
5. **Entitlements**: `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, `cs.disable-library-validation` (required for Python under hardened runtime).
6. **Manual `notarytool submit` + `notarytool log`** — we don't let Tauri's bundler call notarize because its only failure surface is "Invalid" with no audit trail. The split lets us read the per-issue notarytool log when something breaks.

## Cutting a release

```bash
# 1. Bump versions in lockstep
#    - pyproject.toml             (Python package)
#    - src-tauri/tauri.conf.json  (productName.version)
#    Cargo.toml does NOT need updating — picvert v2 bumps via tauri.conf.json.

# 2. Update CHANGELOG.md with a new section.

# 3. Commit and tag.
git add -A
git commit -m "release: v1.2.3"
git push origin main
git tag -a v1.2.3 -m "Picvert v1.2.3"
git push origin v1.2.3
```

The `Release` workflow then:

1. Builds `picvert-engine` on each platform (currently macos-14 arm64 + windows-latest).
2. Runs `pytest -q`.
3. Repairs PyInstaller framework artifacts (install_name + de-symlink + strip ad-hoc).
4. Three-pass codesigns the entire sidecar.
5. Builds the Tauri bundle (`.dmg` / `.app.tar.gz` on macOS, `.msi` / `.exe` / `.exe.sig` on Windows).
6. Manually submits to Apple notarytool, prints the full audit log, staples the ticket on success.
7. Publishes the GitHub Release with all artifacts + a generated `latest.json` for the updater.

**macos-13 (Intel)** is currently disabled — GitHub's runner queue makes Intel runs sit for 30-60 min and Apple Silicon is ≥90% of modern macOS installs. Re-enable in `release.yml` if an Intel-specific issue surfaces.

## How the auto-updater works (Tauri 2)

The app side:

1. On launch (5 s delay) the app invokes `check_for_updates`.
2. That command hits `https://github.com/Akxan/picvert/releases/latest/download/latest.json`, reads the per-platform URL + signature.
3. If newer than running version → JS surfaces a native `ask()` dialog: *"Picvert X.Y.Z is available. Install now?"*
4. On confirm, `install_update` Rust command runs `Update::download_and_install()`, which downloads the platform-specific bundle, verifies the minisign signature against the embedded public key, replaces the app, and `app.restart()`s.
5. The "Check for Updates" tray entry uses the same path (manual trigger).

The signature step is the critical security boundary: even if someone hijacks the GitHub URL or our Releases, they cannot push a payload that wasn't signed by the private key in `picvert-updater.key`.

⚠️ Tauri 1's `dialog: true` flag is **not** what gates the prompt in Tauri 2 — JS does that explicitly via `__TAURI__.dialog.ask`. `bundle.createUpdaterArtifacts: true` in `tauri.conf.json` is what makes the bundler emit the `.app.tar.gz` and `.exe.sig` files the updater reads.

## Manual smoke test before tagging

```bash
# Python tests
.venv/bin/pytest -q

# Build sidecar locally
.venv/bin/python -m PyInstaller engine.spec --clean --noconfirm

# Open the dev shell (uses the locally-built sidecar)
cd src-tauri && cargo tauri dev
```

If the dev shell launches, the engine pings (lower-right turns green "ready"), the formats list appears, and you can convert one PNG to JPG — you're good to tag.

## Disaster recovery

If you lose the contents of `~/Documents/.picvert-signing-backup/`:

- **Tauri signing key** → can be regenerated (`cargo tauri signer generate -w new.key`). But: every existing installed user's app embeds the **old** public key, so they will reject the new signed payloads and stop receiving updates until they manually reinstall. Treat this key like an SSH server key.
- **Apple `.p12`** → also regeneratable (re-export the Developer ID Application certificate from Xcode). Doesn't break installed users — they only verify the Apple signature on first launch, not on updates.
- **App-specific password** → trivial; just generate a new one on the Apple ID site and update the GitHub secret.

So the Tauri signing key is the one you really cannot afford to lose. Back up the `.key` file to 1Password / iCloud / encrypted USB.
