import { getTransfers, parsePeriod, periodStart } from "@/lib/analytics";
import { csvCell, route, tronAddress } from "@/lib/api";

export const dynamic = "force-dynamic";

/** CSV всех переводов адресной книги (или одного адреса) за период; отдаётся потоком. */
export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const period = parsePeriod(q.get("period"), "30d");
  const address = q.get("address") ? tronAddress.parse(q.get("address")) : undefined;
  const since = periodStart(period);
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode("﻿time_utc,tx_hash,from,from_label,to,to_label,amount_usdt\n"));
      const pageSize = 5000;
      for (let offset = 0; ; offset += pageSize) {
        const rows = await getTransfers({ address, since, limit: pageSize, offset });
        const chunk = rows
          .map((r) =>
            [r.blockTimestamp, r.txHash, r.fromAddress, r.fromLabel, r.toAddress, r.toLabel, r.amount].map(csvCell).join(","),
          )
          .join("\n");
        if (chunk) controller.enqueue(enc.encode(chunk + "\n"));
        if (rows.length < pageSize) break;
      }
      controller.close();
    },
  });
  const name = `transfers_${address ?? "all"}_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(stream, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
});
