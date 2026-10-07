// Take a fresh Odoo snapshot from the command line: npm run snapshot
import { prisma } from "../src/lib/db";
import { takeSnapshot } from "../src/lib/snapshot";

const id = await takeSnapshot(process.env.USERNAME ?? "cli", (m) => console.log(m));
console.log(`done: snapshot #${id}`);
await prisma.$disconnect();
