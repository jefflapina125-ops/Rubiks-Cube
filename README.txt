RUBIKS CUBE — MOBILE-FIRST UPDATE

Website files for GitHub Pages.

PHONE / TABLET
- Touch controls are separate from desktop controls.
- Level carousel: swipe left/right with one finger. Do not drag from a button.
- Level 1 has START LEVEL inside its card.
- Game: one-finger drag rotates the camera; tap selects a cube piece; two-finger pinch zooms.
- The page itself is locked against accidental scrolling.
- Fullscreen is requested from a real user gesture and the manifest uses fullscreen display mode.

DESKTOP
- Level carousel keeps mouse drag + keyboard arrows.
- Game keeps right-click camera drag, left-click selection, wheel zoom, and keyboard moves.

INSTALLATION
Replace the existing files in the GitHub Pages repository with every file in this folder.
Because the service-worker cache version has changed, reload the website after deployment. An installed PWA may need to be closed/reopened or reinstalled once for Android to refresh its manifest/icon.

ANDROID APP
The separate Android project in RubiksCube-Android-Mobile-Fullscreen.zip uses the same live GitHub Pages URL and hides Android system bars with immersive mode. It is only needed when using the native APK wrapper.
