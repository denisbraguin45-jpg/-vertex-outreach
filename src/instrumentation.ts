// Instrumentation hook: apply persisted dry-run override on boot and
// recover the system state after restarts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb, getSystemState } = await import("@/db");
  getDb();
  const override = getSystemState("dry_run_override");
  if (override !== null) {
    process.env.OUTREACH_DRY_RUN = override;
  }
}
