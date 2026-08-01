import "dotenv/config";

// Standalone CLI script (run via `tsx prisma/check-seeded.ts`), mirroring
// seed.ts's own provider-resolution pattern. Used by the Docker entrypoint
// as an idempotence guard: seed.ts always upserts OrgProfile id=1 first, so
// its presence is a reliable "has this database been seeded at least once"
// marker without needing a dedicated table.
//
// Exit code 0  => already seeded (caller should skip migrate:xlsx + db:seed)
// Exit code 1  => not seeded yet (caller should run them)
const provider = process.env.DATABASE_PROVIDER ?? "sqlite";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } =
  provider === "postgresql" ? require("./generated/postgres-client") : require("./generated/sqlite-client");
const prisma = new PrismaClient();

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const org = await prisma.orgProfile.findUnique({ where: { id: 1 } });
  if (org) {
    console.log("check-seeded: OrgProfile#1 exists — database already seeded.");
    process.exitCode = 0;
  } else {
    console.log("check-seeded: OrgProfile#1 not found — database not seeded yet.");
    process.exitCode = 1;
  }
}
