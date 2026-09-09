import { getBucket, getD1 } from "@/db";
import { ensureDatabaseSchema } from "@/db/bootstrap";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabaseSchema();
    const { id } = await context.params;
    const record = await getD1()
      .prepare("SELECT filename, object_key AS objectKey, content_type AS contentType FROM workbook_imports WHERE id = ?")
      .bind(id)
      .first<{ filename: string; objectKey: string; contentType: string }>();
    if (!record) return Response.json({ error: "Import not found." }, { status: 404 });

    const object = await getBucket().get(record.objectKey);
    if (!object) return Response.json({ error: "Stored workbook not found." }, { status: 404 });

    return new Response(object.body, {
      headers: {
        "Content-Type": record.contentType,
        "Content-Disposition": `attachment; filename="${record.filename.replace(/["\\]/g, "_")}"`,
        ETag: object.httpEtag,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to download workbook." },
      { status: 500 },
    );
  }
}
