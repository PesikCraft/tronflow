/** Сводка деривативов для страницы и уведомлений: последние сутки снимков по каждой монете. */
import { prisma } from "../db";
import { MARKET_ASSETS } from "./exchanges";
import { summarizeAsset, type AssetMarket } from "./reading";

export async function getMarketOverview(now = Date.now()): Promise<AssetMarket[]> {
  const rows = await prisma.marketSnapshot.findMany({
    // сутки и час запаса — чтобы было с чем сравнить «за 24 ч»
    where: { takenAt: { gte: new Date(now - 25 * 3_600_000) } },
    orderBy: { takenAt: "asc" },
  });
  return MARKET_ASSETS.flatMap((a) => {
    const m = summarizeAsset(
      a,
      rows.filter((r) => r.asset === a),
      now,
    );
    return m ? [m] : [];
  });
}
