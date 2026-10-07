import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env yet */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL ?? "file:data/app.db" },
});
