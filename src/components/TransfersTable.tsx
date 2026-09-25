import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { TransferRow } from "@/lib/analytics";
import { fmtDate, fmtNum, shortAddr, tronscanTx } from "@/lib/format";

function Party({ address, label, self }: { address: string; label: string | null; self?: string }) {
  if (address === self) return <span className="text-fg-2">этот кошелёк</span>;
  return (
    <Link href={`/wallets/${address}`} className="hover:underline" title={address}>
      {label ?? <span className="addr text-xs">{shortAddr(address)}</span>}
    </Link>
  );
}

export function TransfersTable({ rows, self }: { rows: TransferRow[]; self?: string }) {
  if (!rows.length) return <p className="text-muted px-4 py-6 text-sm">Переводов пока нет.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-fg-2 text-left text-xs">
          <tr>
            <th className="px-4 py-2 font-medium">Время (Ереван)</th>
            <th className="px-4 py-2 font-medium">Откуда → куда</th>
            <th className="px-4 py-2 text-right font-medium">Сумма, USDT</th>
            <th className="px-4 py-2 font-medium">Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.txHash}-${r.fromAddress}-${r.toAddress}-${r.amount}`} className="border-line border-t">
              <td className="text-fg-2 num px-4 py-2 whitespace-nowrap">{fmtDate(r.blockTimestamp)}</td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <Party address={r.fromAddress} label={r.fromLabel} self={self} />
                  <ArrowRight size={12} className="text-muted shrink-0" aria-hidden />
                  <Party address={r.toAddress} label={r.toLabel} self={self} />
                </span>
              </td>
              <td className="num px-4 py-2 text-right font-medium">
                {self ? (r.toAddress === self ? "+" : "−") : ""}
                {fmtNum(r.amount)}
              </td>
              <td className="px-4 py-2">
                <a href={tronscanTx(r.txHash)} target="_blank" rel="noreferrer" className="link addr text-xs">
                  {r.txHash.slice(0, 8)}…
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
