import { NextResponse } from "next/server";
import { listExperiments } from "@/db/experiments";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ experiments: listExperiments() });
}
