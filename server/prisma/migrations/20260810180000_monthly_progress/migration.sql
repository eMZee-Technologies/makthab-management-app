-- CreateTable
CREATE TABLE "MonthlyProgress" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "hoursStudied" DOUBLE PRECISION NOT NULL,
    "topicsCovered" TEXT NOT NULL,
    "assessments" TEXT NOT NULL,
    "attendanceDays" INTEGER NOT NULL,
    "moodEngagement" TEXT NOT NULL,
    "goals" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "previousMonthComparison" TEXT,
    "progressPercent" DOUBLE PRECISION,
    "assignmentsCompleted" TEXT,
    "softSkills" TEXT,
    "reminders" TEXT,
    "nextSteps" TEXT,
    "linksJson" TEXT,
    "attachmentsJson" TEXT,
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "editedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyProgress_month_year_idx" ON "MonthlyProgress"("month", "year");

-- CreateIndex
CREATE INDEX "MonthlyProgress_editedById_idx" ON "MonthlyProgress"("editedById");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyProgress_studentId_month_year_key" ON "MonthlyProgress"("studentId", "month", "year");

-- AddForeignKey
ALTER TABLE "MonthlyProgress" ADD CONSTRAINT "MonthlyProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyProgress" ADD CONSTRAINT "MonthlyProgress_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
