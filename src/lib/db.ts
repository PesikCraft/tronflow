import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { pgConnection } from "./pg-config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({
    ...pgConnection(),
    // Размер пула на процесс (веб и воркер — отдельные процессы)
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    // Prisma передаёт даты как UTC без указания пояса. Postgres из Homebrew наследует пояс
    // системы (на Mac в Армении — Asia/Yerevan) и сдвинул бы все времена на 4 часа.
    options: "-c TimeZone=UTC",
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

// Next.js dev перезагружает модули — не плодим пулы соединений.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
