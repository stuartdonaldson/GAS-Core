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
