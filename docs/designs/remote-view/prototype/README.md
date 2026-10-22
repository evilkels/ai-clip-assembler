# Remote View prototype snapshot

This directory preserves the browser assets from the machine-local Remote View
prototype. It is a separate prototype, not the unfinished production Remote
View implementation. The regression runs this browser code against synthetic
project data and generated neutral SVG thumbnails; it does not start or contact
the local API server or use project footage, exports, pairing state, or account
data.

From `frontend/`, run the standalone browser regression with:

```sh
npm run test:e2e:remote-prototype
```

The dedicated Playwright config has no `webServer`. It serves the checked-in
prototype assets and intercepts requests at `http://remote-prototype.test`.
Install the Chromium browser required by Playwright first if it is not already
installed (`npx playwright install chromium`).

The tracked fix does not update the separately served prototype. Deployment to
that machine remains a controller task after review and verification. Refresh
the prototype on an iPhone and confirm the clip grid stays steady while idle.
