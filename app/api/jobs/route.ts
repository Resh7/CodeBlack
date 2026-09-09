import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

function normalizedKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function raw(value: unknown) { try { return JSON.parse(String(value || "{}")) as Record<string, unknown>; } catch { return {}; } }
function field(record: Record<string, unknown>, names: string[]) { const item = Object.entries(record).find(([key]) => names.includes(normalizedKey(key))); return item?.[1] == null ? "" : String(item[1]).trim(); }
function dateMatches(value: string, businessDate: string) {
  const date = new Date(`${businessDate}T12:00:00`); const weekday = date.getDay(); const normalized = normalizedKey(value);
  if (["weekworkingdays", "workingdays", "weekdays", "mondayfriday"].includes(normalized)) return weekday >= 1 && weekday <= 5;
  if (["daily", "everyday", "alldays"].includes(normalized)) return true;
  const candidates = [businessDate, businessDate.slice(2), `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`, `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`];
  return candidates.some((candidate) => value.trim().toLowerCase() === candidate.toLowerCase());
}

export async function GET(request: Request) {
  try {
    await ensureDatabaseSchema();
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim().toLowerCase() ?? "";
    const requestedKind = params.get("kind")?.trim().toUpperCase() ?? "ALL";
    const kind = new Set(["DAILY", "SPECIAL", "VALIDATION"]).has(requestedKind) ? requestedKind : "ALL";
    const businessDate = params.get("businessDate")?.trim() ?? "";
    const rows = await getD1().prepare(
      `SELECT id, job_name AS jobName, description, pre_validation AS preValidation, post_validation AS postValidation,
              comment, raw_json AS rawJson, definition_kind AS definitionKind, source_import_id AS sourceImportId, created_at AS createdAt
       FROM job_definitions WHERE active = 1 ORDER BY created_at, job_name LIMIT 5000`,
    ).all<Record<string, unknown>>();
    const validationRows = rows.results.filter((item) => item.definitionKind === "VALIDATION");
    const validationByName = new Map<string, Record<string, unknown>>();
    for (const item of validationRows) {
      const source = raw(item.rawJson); const aliases = [String(item.jobName || ""), field(source, ["rmjjobname", "rmjjobnames", "rmjname"])];
      for (const alias of aliases) if (alias) validationByName.set(alias.toLowerCase(), item);
    }
    const jobs = rows.results
      .filter((item) => kind === "ALL" || item.definitionKind === kind)
      .filter((item) => !businessDate || item.definitionKind === "VALIDATION" || dateMatches(field(raw(item.rawJson), ["date", "frequency", "rundate"]), businessDate))
      .filter((item) => !query || `${item.jobName} ${item.description} ${item.comment}`.toLowerCase().includes(query))
      .map((item) => {
        const source = raw(item.rawJson); const rmjName = field(source, ["rmjjobname", "rmjjobnames"]) || String(item.jobName || "");
        const validation = item.definitionKind === "VALIDATION" ? item : validationByName.get(rmjName.toLowerCase());
        const schedule = field(source, ["schedulegroup", "schedule", "time", "starttime", "runtime", "frequency"]);
        return {
          id: item.id, jobName: rmjName, displayJobName: String(item.jobName || rmjName), description: item.description, comment: item.comment,
          definitionKind: item.definitionKind, sourceImportId: item.sourceImportId, createdAt: item.createdAt,
          hasPreValidation: Boolean(validation?.preValidation), hasPostValidation: Boolean(validation?.postValidation),
          preValidation: validation?.preValidation ? "AVAILABLE" : "", postValidation: validation?.postValidation ? "AVAILABLE" : "",
          schedule, rawJson: JSON.stringify(source),
        };
      })
      .filter((item) => !businessDate || item.definitionKind !== "VALIDATION")
      .slice(0, 500);
    return Response.json({ jobs, source: businessDate ? "SCHEDULED_WORKBOOK_ROWS" : "IMPORTED_CONFIGURATION", kind, businessDate: businessDate || null });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load imported jobs." }, { status: 500 }); }
}
