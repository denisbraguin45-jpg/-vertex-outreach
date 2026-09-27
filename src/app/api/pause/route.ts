import { NextResponse } from "next/server";
import { isPaused, pauseReason, pauseSystem, resumeSystem } from "@/worker/safety";
import { pauseQueue, resumeQueue } from "@/db/jobs";

export async function POST() {
  if (isPaused()) {
    resumeSystem();
    resumeQueue();
    return NextResponse.json({ paused: false, reason: "" });
  }
  pauseSystem("pausa manual do operador");
  pauseQueue();
  return NextResponse.json({ paused: true, reason: pauseReason() });
}
