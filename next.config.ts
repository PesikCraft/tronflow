import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg и адаптер Prisma — серверные пакеты, не бандлим их
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  poweredByHeader: false,
  // Корень проекта явно: иначе Next может подхватить lock-файл из домашней папки
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
};

export default nextConfig;
