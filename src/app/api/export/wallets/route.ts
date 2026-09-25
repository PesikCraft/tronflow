import { getWalletStats, parsePeriod } from "@/lib/analytics";
import { csvCell, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const period = parsePeriod(new URL(req.url).searchParams.get("period"), "30d");
  const rows = await getWalletStats(period);
  const header = "address,label,category,usdt_balance,inflow,outflow,tx_count,counterparties,last_activity_utc";
  const body = rows
    .map((r) =>
      [r.address, r.label, r.category, r.usdtBalance, r.inflow, r.outflow, r.txCount, r.counterparties, r.lastActivity]
        .map(csvCell)
        .join(","),
    )
    .join("\n");
  return new Response("﻿" + header + "\n" + body + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="wallets_${period}_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
