---
name: electron-build
description: Use when building, releasing, or troubleshooting the Electron app CI/CD pipeline — GitHub Actions builds, artifact downloads, version bumps
applyTo: ".github/**,main.js,package.json"
---

# Electron Build & CI/CD Skill

## Build Overview

Builds run on GitHub Actions (`windows-latest`) on every push to `master` or `main`, or on manual dispatch.

Workflow: [`.github/workflows/build.yml`](.github/workflows/build.yml)

Steps: `npm install` → `npm ci --prefix frontend` → `vite build` → `electron-builder --win portable`

Output artifact: `kahunair-dispatch-exe` containing `KahunaAir Dispatch X.Y.Z.exe`

---

## Standard Build & Download Workflow

```powershell
# 1. Commit and push — CI triggers automatically
git add <files>
git commit -m "description"
git push origin master

# 2. Get the run ID (wait a few seconds for it to register)
Start-Sleep -Seconds 8
$id = (gh run list --repo KahunaTheElder/kahunair-dispatch --limit 1 --json databaseId | ConvertFrom-Json).databaseId
Write-Host "Run: $id"

# 3. Monitor until complete
do {
  Start-Sleep -Seconds 15
  $r = gh run view $id --repo KahunaTheElder/kahunair-dispatch --json status,conclusion | ConvertFrom-Json
  Write-Host "$(Get-Date -Format 'HH:mm:ss') $($r.status) $($r.conclusion)"
} while ($r.status -ne 'completed')

# 4. Download artifact (close the app first if it's running)
Remove-Item "KahunaAir Dispatch *.exe" -Force
gh run download $id --repo KahunaTheElder/kahunair-dispatch --name kahunair-dispatch-exe --dir .
Get-ChildItem *.exe | Select-Object Name, Length, LastWriteTime
```

---

## Diagnosing Build Failures

```powershell
# Get the failed run ID
$id = (gh run list --repo KahunaTheElder/kahunair-dispatch --limit 1 --json databaseId | ConvertFrom-Json).databaseId

# View failed step logs
gh run view $id --repo KahunaTheElder/kahunair-dispatch --log-failed 2>&1 | Out-String | Select-Object -First 1
```

Common failures and fixes:

| Error | Cause | Fix |
|---|---|---|
| `Unterminated regular expression` | Literal `\n` in JSX (tool escaping issue) | Search for `?\(\n` in the file and replace with a real newline |
| `Syntax error "n"` | Same as above | Same fix |
| Stray `</div>` | Mismatched JSX from multi-replace | Count open/close tags around the edited block |
| `Cannot access file ... being used` | App is still running when downloading | Close the app, then re-run the download |
| `HTTP 404` | Wrong run ID (truncated) | Always get full ID via `--json databaseId` |

---

## Credentials & Startup

- Credentials stored at `%APPDATA%\kahunair-dispatch\credentials.json`
- PowerShell writes files with UTF-8 BOM by default — the app must strip `0xFEFF` before `JSON.parse()`
- Startup flow: `.env` → `credentialsManager.loadCredentials()` → set `process.env.*` → verify in background
- The credential dialog fires if `loadCredentials()` returns `null` OR if `JSON.parse` throws on a BOM-prefixed file

---

## Version Bumping

Update `package.json` → `"version"` field. The built exe name (`KahunaAir Dispatch X.Y.Z.exe`) is derived from `productName` + `version` in the `build` config.

---

## Important Notes

- `asar: false` — files are not packed, which means `src/` is readable inside the app bundle
- Output goes to `dist-app/` locally, or to the `kahunair-dispatch-exe` artifact on CI
- `forceCodeSigning: false` — no Windows code signing certificate required
- The `tools/` directory is excluded from the build (not listed in `files`)
- Never use `gh run view <truncated-id>` — always get the full numeric ID via `--json databaseId`
