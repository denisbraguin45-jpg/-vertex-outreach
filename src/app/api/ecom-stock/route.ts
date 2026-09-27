import { NextRequest, NextResponse } from "next/server";
import { createLaunchPlanWithAi, getLaunchPlan, type LaunchInputs } from "@/features/launch/ecom-stock";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ plan: getLaunchPlan() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<LaunchInputs>;
  if (!body.productName || !body.icp || !Array.isArray(body.pains) || !Array.isArray(body.features)) {
    return NextResponse.json(
      { error: "productName, icp, pains e features são obrigatórios" },
      { status: 400 },
    );
  }
  const inputs: LaunchInputs = {
    productName: String(body.productName),
    icp: String(body.icp),
    pains: body.pains.map(String).filter(Boolean),
    features: body.features.map(String).filter(Boolean),
    proof: Array.isArray(body.proof) ? body.proof.map(String).filter(Boolean) : [],
    price: String(body.price ?? ""),
    trialModel: String(body.trialModel ?? "demo guiada"),
    channels: Array.isArray(body.channels) ? body.channels.map(String) : ["instagram", "email"],
  };
  if (!inputs.pains.length || !inputs.features.length) {
    return NextResponse.json({ error: "informe ao menos uma dor e uma feature real" }, { status: 400 });
  }
  const plan = await createLaunchPlanWithAi(inputs);
  return NextResponse.json({ plan });
}
