// One-time import of the img.artbox caches built by the Red Box and Tsagaan gar scripts.
import { prisma } from "../src/lib/db";
//   npm run seed:catalog
import path from "node:path";
import { seedFromOldProjects } from "../src/lib/catalog";

const docs = path.resolve(process.env.USERPROFILE ?? "C:/Users/tsogbat.b", "Documents");
const r = await seedFromOldProjects({
  catalogCsv: path.join(docs, "Tsagaan gar", "catalog.csv"),
  photoDirs: [path.join(docs, "Redbox", "img"), path.join(docs, "Tsagaan gar", "img")],
});
console.log(`catalog rows seen: ${r.catalog}, photos copied: ${r.photos}`);
await prisma.$disconnect();
