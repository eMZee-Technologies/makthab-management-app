import "dotenv/config";

// Standalone CLI script (run via `tsx prisma/check-seeded.ts`), mirroring
// seed.ts's own provider-resolution pattern. Used by the Docker entrypoint
// as an idempotence guard.
//
// Marker: any User row exists. Unlike OrgProfile#1, users are not routinely
// deleted by normal org-profile management, so deleting/replacing the
// letterhead cannot re-trigger seed (which would otherwise risk resetting
// bootstrap accounts if passwords were ever overwritten).
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
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`check-seeded: ${userCount} user(s) exist — database already seeded.`);
    process.exitCode = 0;
  } else {
    console.log("check-seeded: no users found — database not seeded yet.");
    process.exitCode = 1;
  }
}
