-- AlterTable
ALTER TABLE "Role" ADD COLUMN "permissionsVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RolePermissionAudit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "roleId" INTEGER,
    "actorUserId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RolePermissionAudit_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RolePermissionAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RolePermissionAudit_roleId_idx" ON "RolePermissionAudit"("roleId");

-- CreateIndex
CREATE INDEX "RolePermissionAudit_actorUserId_idx" ON "RolePermissionAudit"("actorUserId");

-- CreateIndex
CREATE INDEX "RolePermissionAudit_createdAt_idx" ON "RolePermissionAudit"("createdAt");
