import { getBucket, getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

type ParsedSheet = {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

type ImportMetadata = {
  sheets: ParsedSheet[];
};

type ImportKind = "DAILY" | "SPECIAL" | "VALIDATION";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_METADATA_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 50;
const MAX_ROWS = 20_000;
const MAX_COLUMNS_PER_SHEET = 250;
const MAX_CELL_CHARACTERS = 50_000;
const ALLOWED_EXTENSIONS = new Set(["csv", "xls", "xlsx"]);
const ALLOWED_IMPORT_KINDS = new Set<ImportKind>(["DAILY", "SPECIAL", "VALIDATION"]);

function currentUser(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "Authenticated operator";
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readField(row: Record<string, unknown>, candidates: string[]) {
  const entry = Object.entries(row).find(([key]) => candidates.includes(normalizedKey(key)));
  return entry?.[1] == null ? "" : String(entry[1]).trim();
}

function validateMetadata(metadata: ImportMetadata) {
  if (!Array.isArray(metadata.sheets) || metadata.sheets.length === 0) throw new Error("No readable sheets were found.");
  if (metadata.sheets.length > MAX_SHEETS) throw new Error(`A workbook can contain at most ${MAX_SHEETS} sheets.`);
  let rowCount = 0;
  for (const sheet of metadata.sheets) {
    if (!sheet || typeof sheet !== "object" || typeof sheet.name !== "string" || !sheet.name.trim() || sheet.name.length > 200) {
      throw new Error("Every sheet must have a valid name of 200 characters or fewer.");
    }
    if (!Array.isArray(sheet.columns) || sheet.columns.length > MAX_COLUMNS_PER_SHEET || !sheet.columns.every((column) => typeof column === "string" && column.length <= 200)) {
      throw new Error(`Sheet '${sheet.name}' exceeds the ${MAX_COLUMNS_PER_SHEET}-column limit or contains an invalid column name.`);
    }
    if (!Array.isArray(sheet.rows)) throw new Error(`Sheet '${sheet.name}' does not contain a valid row list.`);
    rowCount += sheet.rows.length;
    if (rowCount > MAX_ROWS) throw new Error(`A workbook can contain at most ${MAX_ROWS.toLocaleString()} rows.`);
    for (const row of sheet.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length > MAX_COLUMNS_PER_SHEET) {
        throw new Error(`Sheet '${sheet.name}' contains an invalid or overly wide row.`);
      }
      for (const [key, value] of Object.entries(row)) {
        if (!key || key.length > 200 || (value != null && !["string", "number", "boolean"].includes(typeof value))) {
          throw new Error(`Sheet '${sheet.name}' contains an unsupported cell value.`);
        }
        if (typeof value === "string" && value.length > MAX_CELL_CHARACTERS) {
          throw new Error(`A cell in sheet '${sheet.name}' exceeds the ${MAX_CELL_CHARACTERS.toLocaleString()}-character limit.`);
        }
      }
    }
  }
}

export async function GET() {
  try {
    await ensureDatabaseSchema();
    const db = getD1();
    const imports = await db
      .prepare(
        `SELECT id, filename, uploaded_at AS uploadedAt, uploaded_by AS uploadedBy,
                import_kind AS importKind, status, sheet_count AS sheetCount, row_count AS rowCount,
                column_count AS columnCount, sheets_json AS sheetsJson,
                columns_json AS columnsJson, changes_json AS changesJson
         FROM workbook_imports
         ORDER BY uploaded_at DESC
         LIMIT 25`,
      )
      .all();
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM job_definitions WHERE active = 1")
      .first<{ count: number }>();
    const counts = await db
      .prepare(
        `SELECT definition_kind AS importKind, COUNT(*) AS count
         FROM job_definitions
         WHERE active = 1
         GROUP BY definition_kind`,
      )
      .all<{ importKind: ImportKind; count: number }>();

    return Response.json({
      imports: imports.results,
      activeJobCount: count?.count ?? 0,
      activeCounts: Object.fromEntries(counts.results.map((row) => [row.importKind, row.count])),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load workbook history." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let objectKey = "";
  let importId = "";
  let importedKind: ImportKind | null = null;
  let catalogSwapped = false;
  try {
    await ensureDatabaseSchema();
    const form = await request.formData();
    const file = form.get("file");
    const metadataValue = form.get("metadata");
    const importKindValue = form.get("importKind");

    if (!(file instanceof File) || typeof metadataValue !== "string" || typeof importKindValue !== "string") {
      return Response.json({ error: "A workbook, import category, and parsed metadata are required." }, { status: 400 });
    }
    const importKind = importKindValue.toUpperCase() as ImportKind;
    if (!ALLOWED_IMPORT_KINDS.has(importKind)) {
      return Response.json({ error: "Choose Daily jobs, Special jobs, or Pre/Post queries." }, { status: 400 });
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return Response.json({ error: "Upload a CSV, XLS, or XLSX file." }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      return Response.json({ error: "The workbook must be between 1 byte and 12 MB." }, { status: 400 });
    }
    if (new TextEncoder().encode(metadataValue).byteLength > MAX_METADATA_BYTES) {
      return Response.json({ error: "Parsed workbook metadata exceeds the 20 MB safety limit." }, { status: 400 });
    }

    let metadata: ImportMetadata;
    try {
      metadata = JSON.parse(metadataValue) as ImportMetadata;
      validateMetadata(metadata);
    } catch (metadataError) {
      return Response.json(
        { error: metadataError instanceof Error ? metadataError.message : "The parsed workbook metadata is invalid." },
        { status: 400 },
      );
    }

    const rows = metadata.sheets.flatMap((sheet) =>
      Array.isArray(sheet.rows) ? sheet.rows.map((row) => ({ sheet: sheet.name, row })) : [],
    );
    const definitions = rows
      .map(({ sheet, row }) => ({
        sheet,
        row,
        jobName: readField(row, ["jobname", "job", "name"]),
        description: readField(row, ["description", "jobdescription"]),
        preValidation: readField(row, ["prevalidation", "prequery", "prevalidationquery"]),
        postValidation: readField(row, ["postvalidation", "postquery", "postvalidationquery"]),
        comment: readField(row, ["comment", "comments", "notes"]),
        preInstructions: readField(row, ["prevalidationinstructions", "preinstructions"]),
        postInstructions: readField(row, ["postvalidationinstructions", "postinstructions"]),
      }))
      .filter((definition) => definition.jobName);

    if (definitions.length === 0) {
      return Response.json(
        { error: "A Job Name column could not be identified. Rename or map that column before importing." },
        { status: 400 },
      );
    }
    const db = getD1();
    const bucket = getBucket();
    const id = crypto.randomUUID();
    importId = id;
    importedKind = importKind;
    objectKey = `workbook-imports/${importKind.toLowerCase()}/${id}/${safeFilename(file.name)}`;
    await bucket.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { uploadedBy: currentUser(request), originalFilename: file.name },
    });

    const previous = await db
      .prepare("SELECT job_name AS jobName FROM job_definitions WHERE active = 1 AND definition_kind = ?")
      .bind(importKind)
      .all<{ jobName: string }>();
    const previousNames = new Set(previous.results.map((row) => row.jobName.toLowerCase()));
    const nextNames = new Set(definitions.map((row) => row.jobName.toLowerCase()));
    const added = importKind === "VALIDATION" ? [...nextNames].filter((name) => !previousNames.has(name)).length : definitions.length;
    const deactivated = importKind === "VALIDATION" ? [...previousNames].filter((name) => !nextNames.has(name)).length : previous.results.length;
    const updated = importKind === "VALIDATION" ? [...nextNames].filter((name) => previousNames.has(name)).length : 0;
    const columns = [...new Set(metadata.sheets.flatMap((sheet) => sheet.columns ?? []))];

    await db.batch([
      db.prepare("UPDATE workbook_imports SET status = 'Previous' WHERE status = 'Active' AND import_kind = ?").bind(importKind),
      db.prepare("UPDATE job_definitions SET active = 0 WHERE active = 1 AND definition_kind = ?").bind(importKind),
      db
        .prepare(
          `INSERT INTO workbook_imports
           (id, filename, object_key, content_type, uploaded_by, import_kind, status, sheet_count,
            row_count, column_count, sheets_json, columns_json, changes_json)
           VALUES (?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          file.name,
          objectKey,
          file.type || "application/octet-stream",
          currentUser(request),
          importKind,
          metadata.sheets.length,
          rows.length,
          columns.length,
          JSON.stringify(metadata.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.length, columns: sheet.columns.length }))),
          JSON.stringify(columns),
          JSON.stringify({ added, updated, deactivated }),
        ),
    ]);
    catalogSwapped = true;

    for (let start = 0; start < definitions.length; start += 40) {
      const statements = definitions.slice(start, start + 40).map((definition) =>
        db
          .prepare(
            `INSERT INTO job_definitions
             (id, job_name, description, pre_validation, post_validation, comment,
              pre_instructions, post_instructions, raw_json, active, definition_kind, source_import_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            definition.jobName,
            definition.description,
            definition.preValidation,
            definition.postValidation,
            definition.comment,
            definition.preInstructions,
            definition.postInstructions,
            JSON.stringify({ sheet: definition.sheet, ...definition.row }),
            importKind,
            id,
          ),
      );
      await db.batch(statements);
    }

    return Response.json(
      {
        import: {
          id,
          filename: file.name,
          importKind,
          status: "Active",
          sheetCount: metadata.sheets.length,
          rowCount: rows.length,
          columnCount: columns.length,
          normalizedJobs: definitions.length,
          changes: { added, updated, deactivated },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (objectKey) {
      try {
        await getBucket().delete(objectKey);
      } catch {
        // Preserve the original failure response. An orphaned object can be audited later.
      }
    }
    if (catalogSwapped && importId && importedKind) {
      try {
        const db = getD1();
        await db.batch([
          db.prepare("DELETE FROM job_definitions WHERE source_import_id = ?").bind(importId),
          db.prepare("DELETE FROM workbook_imports WHERE id = ?").bind(importId),
        ]);
        const previousImport = await db
          .prepare("SELECT id FROM workbook_imports WHERE import_kind = ? AND status = 'Previous' ORDER BY uploaded_at DESC LIMIT 1")
          .bind(importedKind)
          .first<{ id: string }>();
        if (previousImport) {
          await db.batch([
            db.prepare("UPDATE workbook_imports SET status = 'Active' WHERE id = ?").bind(previousImport.id),
            db.prepare("UPDATE job_definitions SET active = 1 WHERE source_import_id = ?").bind(previousImport.id),
          ]);
        }
      } catch {
        // Preserve the original response. The failed import remains inactive and is recoverable from audit data.
      }
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "The workbook could not be imported." },
      { status: 500 },
    );
  }
}
