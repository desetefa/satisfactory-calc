import { NextRequest, NextResponse } from "next/server";
import { getItem, getFluid, getAllItems, getAllFluids } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (key) {
    const item = getItem(key) ?? getFluid(key);
    if (!item) return NextResponse.json({ error: "Item or fluid not found" }, { status: 404 });
    return NextResponse.json(item);
  }

  return NextResponse.json({ items: getAllItems(), fluids: getAllFluids() });
}
