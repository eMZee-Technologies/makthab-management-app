-- CreateTable
CREATE TABLE "Contribution" (
    "id" SERIAL NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "contributorName" TEXT NOT NULL,
    "contributorType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "notes" TEXT,
    "whatsappNo" TEXT,
    "pdfPath" TEXT,
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_receiptNo_key" ON "Contribution"("receiptNo");

-- CreateIndex
CREATE INDEX "Contribution_date_idx" ON "Contribution"("date");

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
