RUBIK'S CUBE MOBILE UI UPDATE

Upload these files to the ROOT of your existing GitHub Pages repository, replacing index.html, style.css, and script.js: index.html, style.css, script.js, manifest.webmanifest, icon.svg, sw.js.

Mobile UI: compact floating panels, responsive spacing, collapsible help, fullscreen button. Drag on the cube or empty canvas area to orbit; tapping without dragging selects a cubie.

After deployment, open the website in Chrome and refresh. If installed as a PWA, remove only the old Rubik's Cube app/shortcut and install it again to refresh the icon/manifest.

Fullscreen note: the fullscreen button requests browser fullscreen when supported. Android may still show system bars depending on browser, OS, and install mode; websites cannot force-hide Android notification/navigation bars in every configuration. The manifest requests fullscreen display for installed PWAs.
