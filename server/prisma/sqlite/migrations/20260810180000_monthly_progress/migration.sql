-- CreateTable
CREATE TABLE "MonthlyProgress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "studentId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "hoursStudied" REAL NOT NULL,
    "topicsCovered" TEXT NOT NULL,
    "assessments" TEXT NOT NULL,
    "attendanceDays" INTEGER NOT NULL,
    "moodEngagement" TEXT NOT NULL,
    "goals" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "previousMonthComparison" TEXT,
    "progressPercent" REAL,
    "assignmentsCompleted" TEXT,
    "softSkills" TEXT,
    "reminders" TEXT,
    "nextSteps" TEXT,
    "linksJson" TEXT,
    "attachmentsJson" TEXT,
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "editedById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MonthlyProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MonthlyProgress_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "Staff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MonthlyProgress_month_year_idx" ON "MonthlyProgress"("month", "year");

-- CreateIndex
CREATE INDEX "MonthlyProgress_editedById_idx" ON "MonthlyProgress"("editedById");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyProgress_studentId_month_year_key" ON "MonthlyProgress"("studentId", "month", "year");
