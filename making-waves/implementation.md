# Implementation Notes

**Stack:** Plain HTML, CSS, JavaScript — no build step required.

**Serving & Paths**
- Demos are standalone HTML files in `/demos/` and reference `/lib/physics-lab.js` with relative or absolute paths.
- Docsify renders Markdown at `/making-waves/` (index.html) and links to demos with absolute paths to ensure full-page navigation.

**Shared library**
- `lib/physics-lab.js` contains shared utilities and registration of audio/WebAudio worklets where needed.

**Development notes**
- Use unique filenames for demo assets to avoid collisions.
- When updating shared libraries, consider a cache-busting strategy (e.g., query string versions) if immediate updates are required for remote testers.
