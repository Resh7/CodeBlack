# Color Studio: approved dashboard redesign

This complete source package applies the approved charcoal, coral, violet, cyan, and sage design to Batch Operations Control Center.

## What changed

- A rounded charcoal workspace on a sage canvas, with a readable single-column sidebar.
- An asymmetric dashboard: coral jobs due, violet validations, cyan scheduled jobs, sage connector health, and a dark connection summary.
- Bold condensed headings using a locally bundled font. No external font service is needed when running the app.
- Consistent tables, filters, editors, dialogs, badges, import cards, and connection settings across all tabs.
- Dashboard shortcuts to Scheduled or Unscheduled validations, report tools, and workbook sources.
- Subtle decorative motion and hover feedback, with Pause and system reduced-motion support.

The dashboard displays real workbook counts and connection states. Its numbers will reflect your own selected date, environment, saved imports, and available services.

## Update your existing working installation

1. Stop the website and local connector terminals with Ctrl+C.
2. Back up your existing project folder.
3. Extract this ZIP into a temporary folder. Copy its contents into your existing project folder, replacing matching source files. Do not delete the existing folder first.
4. Keep your existing `.local-bes-config.json`, `.wrangler/`, `.dev.vars`, and other private local state. These files are intentionally excluded from this ZIP.
5. Restart the website from your updated project folder:

   ```powershell
   npm run dev
   ```

6. Restart the connector in another terminal in that same folder:

   ```powershell
   npm run local-agent
   ```

7. Open the same local URL and port you used before. Press Ctrl+Shift+R to refresh cached styling. Using the same browser origin preserves browser-stored RMJ imports.

Dependencies and the lockfile have not changed. An existing installation does not need a new dependency install. For a fresh folder, follow README.md and install with `npm install` using Node.js 22.13 or later. A fresh folder does not automatically contain your previous local state.

If you run a production build instead of development mode, rebuild the updated source with `npm run build:local` before `npm run start`.

## Confirm you are running this version

The dashboard should have a large coral jobs panel, violet validation panel, cyan scheduled table, and sage connector card. If it still shows the older design, confirm that you started the updated folder and copied these together:

- `app/color-studio.css`, `app/globals.css`, and `app/layout.tsx`
- Updated `components/control-center.tsx` and `components/live-operations.tsx`
- The `public/fonts/` folder

The earlier Orbital stylesheet and artwork are unused. This ZIP updates the local project; it does not publish the separate hosted website.

## Existing behavior retained

GCS bucket routing, paging and caches, filename and column handling, previews, downloads, analysis, structured report CSV conversion, workbook matching, selected business dates, environment profiles, RMJ copying/opening, validation queries, connector tests, and logging use the same underlying functional code.

The Scheduled and Unscheduled dashboard shortcuts select which validation list opens. They do not execute any query. The report shortcut opens Files & Reports, where View, Download, Analyze, and CSV still operate on the selected file.

## Verification

- TypeScript verification and production build passed.
- All five existing release tests passed.
- Thirty-six protected API, database, connector, dependency, script, test, and hosting files were unchanged from the working package baseline.
- All 133 existing distinct event-handler expressions across the six principal UI components were retained.
- Existing GCS report column sizing and report-processing source were unchanged.

Authenticated DB, GCS, and RMJ operations require your local accounts and connector. Those private connections were not tested in this environment. Browser visual testing and a hosted deployment were not performed for this package.

Additional project context is included in `Control-Center-New-Chat-Handoff.md`.
