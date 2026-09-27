import { NextResponse } from "next/server";
import { aiCostStats } from "@/db/messages";
import { getEnv } from "@/config/env";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = getDb();
  const stats = aiCostStats();
  const leadsContacted = (
    d.prepare("SELECT COUNT(DISTINCT lead_id) as n FROM messages WHERE direction = 'outbound'").get() as { n: number }
  ).n;
  const customers = (
    d.prepare("SELECT COUNT(*) as n FROM leads WHERE pipeline IN ('active_customer','active_affiliate')").get() as { n: number }
  ).n;

  return NextResponse.json({
    monthTotal: stats.monthTotal,
    budget: getEnv().OPENAI_MONTHLY_BUDGET_USD,
    byModel: stats.byModel,
    leadsContacted,
    customers,
    costPerCustomer: customers > 0 ? stats.monthTotal / customers : null,
  });
}
