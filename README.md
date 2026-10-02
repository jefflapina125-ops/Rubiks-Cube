# 3D Rubik's Cube

A browser-based interactive 3D Rubik's Cube, ready to publish with GitHub Pages. Includes responsive controls, mobile portrait guidance, a landscape-oriented installable PWA manifest, and a small app-shell cache.

## Publish it on GitHub Pages

1. Create a new repository on GitHub (for example, `rubiks-cube-app`).
2. Upload **all files in this folder** to the repository root. Make sure `index.html`, `style.css`, and `script.js` are at the top level, not inside another nested folder.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Choose branch **main** and folder **/(root)**, then click **Save**.
6. Wait for the Pages deployment to finish. Your app will be available at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

## Use it on Android

- Open the GitHub Pages URL in Chrome.
- For a more app-like experience, use Chrome's menu and choose **Install app** or **Add to Home screen** when offered. The manifest requests landscape orientation for supported installed-app contexts.
- Browsers do not all permit webpages to force landscape orientation. If the page opens in portrait, rotate the phone sideways. The portrait prompt can be dismissed with **Continue anyway**.

## Notes

- Three.js and Tween.js are loaded from public CDNs, so an internet connection is required to load those libraries. The service worker caches the local app files but does not cache the CDN libraries.
- This is a static site; no build command or backend is needed.
