import { getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

const BLOCKED_KEYS = /password|privatekey|clientsecret|accesstoken|refreshtoken/i;

function currentUser(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "Authenticated administrator";
}

export async function GET() {
  try {
    await ensureDatabaseSchema();
    const rows = await getD1()
      .prepare(
        `SELECT key, category, value_json AS valueJson, updated_at AS updatedAt,
                updated_by AS updatedBy
         FROM application_settings
         ORDER BY category, key`,
      )
      .all<{ key: string; category: string; valueJson: string; updatedAt: string; updatedBy: string }>();
    return Response.json({
      settings: rows.results.map((row) => ({ ...row, value: JSON.parse(row.valueJson) })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load settings." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    await ensureDatabaseSchema();
    const payload = (await request.json()) as { key?: string; category?: string; value?: unknown };
    const key = payload.key?.trim() ?? "";
    const category = payload.category?.trim() ?? "";
    if (!key || !category || payload.value == null) {
      return Response.json({ error: "Key, category, and value are required." }, { status: 400 });
    }
    const serialized = JSON.stringify(payload.value);
    if (BLOCKED_KEYS.test(serialized)) {
      return Response.json(
        { error: "Passwords and tokens cannot be stored here. Save only a secret reference." },
        { status: 400 },
      );
    }

    await getD1()
      .prepare(
        `INSERT INTO application_settings (key, category, value_json, updated_at, updated_by)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT(key) DO UPDATE SET
           category = excluded.category,
           value_json = excluded.value_json,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = excluded.updated_by`,
      )
      .bind(key, category, serialized, currentUser(request))
      .run();

    return Response.json({ setting: { key, category, value: payload.value } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to save settings." },
      { status: 500 },
    );
  }
}
