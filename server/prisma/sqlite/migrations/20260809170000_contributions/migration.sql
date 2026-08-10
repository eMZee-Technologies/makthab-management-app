-- CreateTable
CREATE TABLE "Contribution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "amount" REAL NOT NULL,
    "contributorName" TEXT NOT NULL,
    "contributorType" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "notes" TEXT,
    "whatsappNo" TEXT,
    "pdfPath" TEXT,
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contribution_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_receiptNo_key" ON "Contribution"("receiptNo");

-- CreateIndex
CREATE INDEX "Contribution_date_idx" ON "Contribution"("date");
