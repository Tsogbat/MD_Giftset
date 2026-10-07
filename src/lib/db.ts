import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

function dbUrl(): string {
  const url = env("DATABASE_URL") ?? "file:data/app.db";
  if (!url.startsWith("file:")) return url;
  return "file:" + path.resolve(url.slice(5)).split(path.sep).join("/");
}

const g = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = g.prisma ?? new PrismaClient({ adapter: new PrismaLibSql({ url: dbUrl() }) });
if (process.env.NODE_ENV !== "production") g.prisma = prisma;
