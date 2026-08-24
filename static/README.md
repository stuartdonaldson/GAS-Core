# static/

Live demo published via GitHub Pages, illustrating the pattern documented in
[`../best-practices/gas-static-frontend/README.md`](../best-practices/gas-static-frontend/README.md):
a static, top-level HTML page calling a Google Apps Script web app as a plain JSON API, plus a
worked Google Identity Services sign-in check.

Published (once GitHub Pages is enabled on this repo) at:
`https://stuartdonaldson.github.io/GAS-Core/`

This is deliberately a single self-contained `index.html` — no build step, no framework. It has
no working backend of its own; the "GAS web app /exec URL" and "Google client ID" fields on the
page are left blank for you to fill in with your own deployment of
[`../best-practices/gas-static-frontend/gas-backend-example.js`](../best-practices/gas-static-frontend/gas-backend-example.js)
to try the pattern live. Everything you type stays in your own browser's `localStorage`.

Deployed automatically by [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml)
on every push to the default branch that touches this folder.

## Try it yourself

The page has no backend of its own — you deploy your own copy of
[`gas-backend-example.js`](../best-practices/gas-static-frontend/gas-backend-example.js) and point
the page at it. Nothing you type leaves your browser except calls to the URL you provide.

Requires: [`clasp`](https://github.com/google/clasp) (`npm install -g @google/clasp`), logged in
once (`clasp login`), and a Google account.

### 1. Deploy your own backend (`ping` action — no identity needed)

```bash
cd best-practices/gas-static-frontend
clasp create --type webapp --title "GAS-Core static-frontend demo" --rootDir .
```

`clasp create` writes its own `appsscript.json` — overwrite it with the one in this folder so the
web app is anonymous-accessible, then push and deploy:

```bash
cp appsscript.json.example appsscript.json
clasp push -f
clasp deploy -d "static-frontend demo"
clasp deployments   # lists deployment ids -- use the one that is NOT "@HEAD"
```

Your web app URL is `https://script.google.com/macros/s/<deploymentId>/exec`. Paste that into the
page's **"GAS web app /exec URL"** field and click **"Call ping action"** — this alone proves the
CORS/JSON round trip; no Google Cloud Console setup needed for it.

### 2. (Optional) Add Google sign-in (`whoami` action)

1. [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) —
   select the project `clasp create` used (`clasp open-credentials-setup` opens it directly) or any
   other project.
2. If prompted, configure the OAuth consent screen first: **External**, any app name, no scopes
   beyond the defaults — `openid`/`email`/`profile` need no Google review or verification.
3. **Create Credentials → OAuth client ID → Application type: Web application.**
4. Under **Authorized JavaScript origins**, add the exact origin serving the static page (e.g.
   `https://stuartdonaldson.github.io` for the published demo, or `http://localhost:<port>` if
   you're serving `static/` locally).
5. Create, copy the client ID, paste it into the page's **"Google Identity Services client ID"**
   field.
6. Sign in once — the status line will show `sub=...` for your account after server verification
   (with `allowlisted: false`, since nothing is allowlisted yet). To see the `allowlisted: true`
   path: `clasp open-script`, then Project Settings → Script Properties, and add:
   - `GIS_CLIENT_ID` = the same client ID from step 4
   - `GIS_ALLOWLIST_SUBS` = the `sub` value from the status line

   Sign in again — the page now reports `allowlisted: true`.
