import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { WalletsManager } from "@/components/WalletsManager";

export const metadata: Metadata = { title: "Кошельки" };

export default function WalletsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Кошельки"
        lead="Адресная книга. После добавления воркер загрузит историю за 30 дней и дальше будет видеть каждый новый перевод."
      />
      <Suspense>
        <WalletsManager />
      </Suspense>
    </div>
  );
}
