import { NextResponse } from "next/server";
import { getDb, DATA_VERSION } from "@/lib/db";

/**
 * GET /api/data - Returns full Satisfactory database
 * Use specific endpoints below for smaller payloads
 */
export async function GET() {
  const db = getDb();
  return NextResponse.json({
    version: DATA_VERSION,
    data: db,
  });
}
