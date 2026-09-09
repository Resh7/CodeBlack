# Batch Operations Control Center

An enterprise UAT control center for real RunMyJobs, Google Cloud Logging, Google Cloud Storage, Oracle, and MongoDB data. The application has no sample-data fallback. A connector reports `CONNECTED` only after its server-side health operation succeeds.

## Latest visual update: Color Studio

This package implements the approved charcoal dashboard with coral, violet, cyan, and sage panels, bold condensed headings, a single-column sidebar, and subtle motion. Read `COLOR-STUDIO-UPGRADE.md` first when updating an existing installation so saved connections and imports are retained.

## Start on Windows

This project requires Node.js 22.13 or newer. Node 20.20.2 cannot run its Vite and Vinext dependencies.

1. Open a new Command Prompt or PowerShell window.
2. If you use nvm-windows, install and select a current Node 22 release:

   ```powershell
   nvm list available
   nvm install <latest-22.x-version>
   nvm use <latest-22.x-version>
   where.exe node
   node --version
   ```

3. The final command must print `v22.13.0` or newer. If it still prints Node 20, close all terminals, open a new one, run `nvm use` again, and check `where.exe node` for an older Node installation earlier in `PATH`.
4. From this project folder, install and start the application:

   ```powershell
   npm install
   npm run dev
   ```

5. Open the local URL printed by Vite, normally `http://localhost:5173`.

The development script is Windows-safe. Do not add a Unix-style prefix such as `WRANGLER_LOG_PATH=... npm run dev`; that syntax caused the earlier Windows error. The Vite configuration sets the Wrangler paths internally.

## Local storage and first launch

## Local BES cookie testing

For Local BES job tests, run these in separate terminals:

```powershell
npm run dev
npm run local-agent
```

Open **Settings**, select a Local BES action, and paste a freshly captured Cookie header value when prompted. The cookie is cleared immediately after the request and is never stored.

Local development uses project-local Cloudflare Miniflare storage for D1 and R2. The application creates its required D1 tables idempotently on the first API request. Settings, workbook imports, catalogs, validations, audit records, and local workbook files therefore work after a fresh `npm run dev` without a separate migration command.

Local state is stored under `.wrangler/` and is intentionally excluded from the ZIP and Git.

## Local Google Cloud Storage

The Local BES GCS browser uses the Google Cloud CLI identity signed in on your computer. It does not use browser cookies and does not copy a GCS file into the application before downloading it.

1. Sign in once with your company account and select the project:

   ```powershell
   gcloud auth application-default login
   gcloud config set project bes-np
   ```

2. Verify that the account can list the required bucket:

   ```powershell
   gcloud storage ls gs://dhs-bes-np-gcs-intcons-to-process-local
   ```

3. Keep `npm run local-agent` running. In **Settings** under Local BES, enter the Google Cloud project, bucket name, and an optional allowed root prefix such as `BatchControlReport/LOCAL/`. Save and test the Local GCS files card.
4. Open **Files & Reports** or **GCS Files** in Local BES. The browser lists real objects through `gcloud`; the Download action streams the selected object straight from the bucket to your browser.

## Runtime secrets

Settings stores only non-secret connection details. Copy `.dev.vars.example` to `.dev.vars` for local testing and add only the credentials needed for the connectors you will test.

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Never upload or commit `.dev.vars`. Restart `npm run dev` after changing runtime secrets.

| Connector | Runtime secret | Accepted value |
| --- | --- | --- |
| RunMyJobs Bearer or API key | `RMJ_API_TOKEN` | Tenant-issued token |
| RunMyJobs Basic | `RMJ_BASIC_CREDENTIALS` | Plain `username:password`; the server performs Base64 encoding |
| Google Cloud Logging and Storage | `GCP_SERVICE_ACCOUNT_JSON` | Complete service-account JSON with read-only permissions |
| GCS-only alternate identity | `GCS_SERVICE_ACCOUNT_JSON` | Complete service-account JSON |
| Oracle HTTPS gateway | `ORACLE_GATEWAY_TOKEN` | Gateway Bearer token |
| MongoDB HTTPS gateway | `MONGODB_GATEWAY_TOKEN` | Gateway Bearer token |

Short-lived `GCP_ACCESS_TOKEN` and `GCS_ACCESS_TOKEN` values are also supported for temporary testing. A service account is the stable option.

## Configure and test real connections

Open **Settings**, select one connector, complete every required field, save it, then select **Test real connection**. The test result, latency, capabilities, error category, and correlation ID are recorded in Audit History.

### RunMyJobs

The supplied tenant and Swagger roots are prefilled. Use the tenant Swagger to provide:

- a harmless read-only probe path;
- the jobs collection path;
- the exact business-date query parameter;
- optional status and search query parameter names;
- the tenant authentication mode.

Past and future business dates are sent upstream only after the business-date parameter is configured. The app will not pretend that a date filter was applied.

### Google Cloud Logging

The connector is restricted to the approved project, Kubernetes resource type, namespaces, and BES microservices configured in Settings. The service account needs read-only Logging access, normally `roles/logging.viewer` on the selected project.

### Google Cloud Storage

The first release is restricted to bucket `dhs-bes-np-gcs-intcons-to-process` and the approved folder prefixes shown in Settings. The identity needs object list and get permissions. Object downloads can be disabled independently while preview remains available.

### Oracle and MongoDB

The hosted web worker cannot open private Oracle or MongoDB sockets. Each database must be exposed through an organization-approved private HTTPS connector gateway:

- Oracle health operation: `oracle_health_check`, proving `SELECT 1 FROM DUAL`;
- MongoDB health operation: `mongodb_ping`, using the official driver;
- validation operation: `oracle_read_validation` or `mongodb_read_validation`;
- request body includes the imported query template, validated parameters, business date, row limit, and `readOnly: true`;
- response must be JSON and no larger than 2 MB.

The gateway token stays server-side. SQL writes and MongoDB write-capable operators are rejected before a request leaves the application.

## Workbook imports

Excel Management has independent upload flows for:

- Daily jobs;
- Special jobs;
- Pre and Post queries.

Accepted file types are CSV, XLS, and XLSX. The browser parses the workbook and sends normalized metadata plus the original file. The server validates size, sheet, row, column, cell, and duplicate-job limits. If any definition insert fails, it removes the partial import and restores the previous active version.

## Verification commands

```powershell
npm run lint
npm run typecheck
npm run build:local
```

`npm run build` is the bounded Linux build used by the hosted Sites lifecycle. `npm run build:local` is the portable direct build for Windows and macOS.

## Production deployment notes

The hosted release uses the D1 binding `DB` and R2 binding `BUCKET` from `.openai/hosting.json`. Drizzle migrations are packaged with the deployment. Add runtime secrets through the hosting environment, never through browser Settings. The site is owner-only by default.

## Safety behavior

- No connector health is inferred from static rows.
- Secrets are never returned to the browser or stored in D1.
- GCS list, preview, and download operations enforce configured prefix allowlists.
- Cloud Logging filters are generated server-side from approved values.
- Scheduler responses are normalized and raw upstream payloads are not returned.
- Imported validation queries remain server-side.
- Every connector test and real data operation records an audit event when storage is available.
