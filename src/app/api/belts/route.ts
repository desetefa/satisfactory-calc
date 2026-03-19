import { NextResponse } from "next/server";
import { getAllBelts } from "@/lib/db";

export async function GET() {
  const belts = getAllBelts();
  return NextResponse.json(belts);
}
