# Security Summary

## Overview & Readiness
A security and open-source release review was completed across `src/`, `electron/`, `server.ts`, configuration files, and project dependencies to prepare **Ábaco Pizarra Virtual** for public distribution on GitHub.

### Safeguards Verified
| Area | Status | Notes |
| --- | --- | --- |
| Secrets, tokens & local paths | Verified Clean | No API keys, credentials, or local machine file paths found in source or configs; `.env.example` contains only empty placeholders and `.gitignore` excludes `.env`, `.env.*`, `local-data/`, `release/`, and `release-windows/`. |
| Imported DOCX / `.pizarra` HTML rendering | Fixed | Added `sanitizeDocumentHtml` allowlist sanitizer in `src/utils/documentImporter.ts` and memoized sanitization in `src/components/nodes/DocumentNodeView.tsx` before rendering. |
| Interactive KaTeX equation rendering | Fixed | Replaced permissive `trust: true` in `src/utils/latexEditorEngine.ts` with a strict allowlist callback allowing only internal `\htmlClass` and `\htmlData` markers. |
| Local Express file routes | Fixed | Added `resolveSafeSubpath` directory confinement and empty-ID validation across `/api/folders/:id` and `/api/projects/:id*` routes in `server.ts`. |
| Third-party dependency audit (`xlsx@0.18.5`) | Needs Follow-Up | Existing SheetJS `xlsx@0.18.5` dependency has known upstream advisories (`Prototype Pollution` and `ReDoS`) with no newer patched release available on the public npm registry. Spreadsheet imports should be limited to trusted files or migrated to a maintained parser if untrusted public uploads will be accepted. |

---

## PoC Verification

### 1. Imported Document HTML Sanitization
- **Input / Vector Tested:** Crafted `.docx` conversion HTML or external `.pizarra` payload containing `<script>alert(1)</script>`, `<img src=x onerror="alert(1)">`, and `<a href="javascript:alert(1)">link</a>` passed into `sanitizeDocumentHtml` and `DocumentNodeView`.
- **Outcome:** `<script>` subtrees are removed, `onerror` and inline attributes outside the tag allowlist are stripped, and `javascript:` links are dropped while preserving safe structural tags (`<p>`, `<table>`, safe `https:` links, and `data:image/*` base64 images).

### 2. Server Storage Path Confinement
- **Input / Vector Tested:** Empty or non-alphanumeric identifiers (e.g., `...` or empty after `sanitizeId`) sent to `/api/projects/:id` or `/api/projects/:id/snapshots/:snapId`.
- **Outcome:** Empty sanitized IDs are rejected early with HTTP `400`, and all resolved filesystem paths are verified with `resolveSafeSubpath` to remain strictly inside `PROJECTS_DIR` or `SNAPSHOTS_DIR`.

### 3. KaTeX Interactive Rendering Restriction
- **Input / Vector Tested:** Equation strings containing `\href{javascript:alert(1)}{...}` or `\htmlStyle{...}{...}` rendered through `renderInteractiveEquationHtml`.
- **Outcome:** The `trust` callback in `src/utils/latexEditorEngine.ts` permits only `\htmlClass` and `\htmlData`, causing KaTeX to reject untrusted URL and inline-style commands cleanly.
