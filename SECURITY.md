# Security Policy

## Supported versions

Only the current `main` branch, deployed at https://spline-xr.netlify.app, is supported.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting instead: go to the repository's **Security** tab, then **Report a vulnerability**. Describe the problem, the steps to reproduce it and the possible impact. You will get an answer as soon as possible; this is a small volunteer project, so please allow a few days.

## Scope

Things worth reporting include:

- the preview image endpoint (`/api/thumb/<id>`, `netlify/functions/thumb.mjs`): bypassing the size and format checks, storing arbitrary content, reading or overwriting unrelated data;
- script injection through link parameters (titles, scene IDs, Spline file IDs) or link previews (`netlify/edge-functions/og.js`);
- expressions coming from Spline scenes (`src/animate.js` evaluates them without `eval`): any way to make a scene run code;
- anything that would let a link run code, load content from outside Spline, or redirect somewhere unexpected.

Out of scope: the Spline runtime and loader themselves (report those to Spline), and denial of service by volume.
