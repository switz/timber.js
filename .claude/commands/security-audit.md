Run a timber.js security audit against `design/13-security.md`.

If $ARGUMENTS is set (a PR number), audit that specific PR. If empty, audit all open PRs.

## Security authority

Read `design/13-security.md` in full before every audit. Secondary refs:
- `07-routing.md` — URL canonicalization, encoded separator/null byte rejection, Link scheme validation
- `08-forms-and-actions.md` — CSRF, FormData limits, redirect allow-list
- `04-authorization.md` — AccessGate, `deny()`, slot degradation
- `06-caching.md` — cache key collision, poisoning

## PR audit workflow

1. `gh pr view $ARGUMENTS` and `gh pr diff $ARGUMENTS`
2. Identify security-sensitive surfaces (request parsing, auth, server actions, cache keys, HTML serialization, redirects, regex, file paths)
3. Audit against the vulnerability taxonomy from `13-security.md`:
   - Cross-request state pollution (ALS misuse, module-level variables)
   - Cache poisoning (Vary headers, cache key identity)
   - Path traversal / double-decode (%2f, %00 rejection)
   - Middleware bypass (regex patterns, encoding tricks)
   - Open redirect (absolute URLs, protocol-relative)
   - XSS via Link scheme (javascript:, data:)
   - Cache key collision (user identity in keys)
   - CSRF (Origin header validation)
   - SSRF (remotePatterns validation)
   - FormData limits (size cap before parsing)
   - Host header poisoning
   - ReDoS (isSafeRegex)

4. Search for dangerous patterns:
   ```bash
   rg "Object\.fromEntries.*[Hh]eader" --type ts
   rg "eval\(|new Function\(" --type ts
   rg "innerHTML|dangerouslySetInnerHTML" --type ts
   rg "redirect\(.*https?://" --type ts
   ```

5. File bd issues for each finding:
   ```bash
   bd create "security: <description>" \
     --description="Finding: <description>. Location: <file:line>. Vulnerability class: <from 13-security.md>. Attack scenario: <concrete exploit>. Severity: <critical/high/medium/low>. Suggested fix: <specific approach>. Test case: <what to add>." \
     -t bug -p <0-3> --json
   ```

6. Post PR comment summarizing findings and clean areas.

## Severity guide

- **Critical (P0)**: Exploitable without auth, leads to data loss/RCE/auth bypass
- **High (P1)**: Exploitable by authenticated users, significant impact
- **Medium (P2)**: Unusual conditions or limited impact, fix before ship
- **Low (P3)**: Defense-in-depth, unlikely in practice
