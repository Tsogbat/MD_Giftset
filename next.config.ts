import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "sharp", "exceljs", "@libsql/client", "@prisma/adapter-libsql"],
  devIndicators: false,
};

export default nextConfig;
