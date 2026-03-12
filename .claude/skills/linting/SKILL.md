---
name: linting
description: Use before deploying any files containing code
applyTo: "**/*.js,**/*.jsx,**/*.css"
---

# Linting & Pre-Deploy Checks

## Always Do Before Pushing

1. **Check for errors** using the `get_errors` tool on any edited files
2. **Verify JSX structure** — count open vs close tags/parentheses after any replace operation
3. **Check for literal escape sequences** — tool substitutions can produce literal `\n`, `\t` etc. in source files

## JSX-Specific Gotchas (This Project)

| Symptom | Cause | Fix |
|---|---|---|
| `Unterminated regular expression` at build | Literal `\n` written into JSX | Search file for the string `\n` and replace with real newline |
| Extra `</div>` after multi-replace | Old wrapper div not removed | Read surrounding context, count tags |
| `Syntax error "n"` | Same as literal `\n` | Same fix |

## JS Linting (Node.js / Electron)

```powershell
# Quick require-check (catches syntax errors)
node -e "require('./src/fileToCheck.js')" 2>&1
```

## Frontend Build Check (Vite)

```powershell
npm run build --prefix frontend 2>&1 | Select-String "error|Error|warn"
```

Running a local build before pushing catches 100% of the JSX/CSS compile errors that would otherwise fail CI.

## CSS

- Check for unclosed braces after large block replacements
- Confirm all class names referenced in JSX exist in the CSS (or are intentional inline styles)

## General Rules

- After every `multi_replace_string_in_file`, always call `get_errors` on the changed files
- If a build fails on CI, read the log with `gh run view <id> --log-failed` before retrying
- Never retry a failed build without first reading the error — it will fail the same way
