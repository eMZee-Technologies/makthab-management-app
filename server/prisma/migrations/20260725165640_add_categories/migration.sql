-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "_CategoryToClass" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_CategoryToClass_A_fkey" FOREIGN KEY ("A") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_CategoryToClass_B_fkey" FOREIGN KEY ("B") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FeeStructure" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "classId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "academicYearId" INTEGER NOT NULL,
    "feeType" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    CONSTRAINT "FeeStructure_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeeStructure_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FeeStructure" ("academicYearId", "amount", "classId", "feeType", "id") SELECT "academicYearId", "amount", "classId", "feeType", "id" FROM "FeeStructure";
DROP TABLE "FeeStructure";
ALTER TABLE "new_FeeStructure" RENAME TO "FeeStructure";
CREATE UNIQUE INDEX "FeeStructure_classId_categoryId_academicYearId_feeType_key" ON "FeeStructure"("classId", "categoryId", "academicYearId", "feeType");
CREATE TABLE "new_Student" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "admissionNo" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "fatherName" TEXT NOT NULL,
    "dateOfBirth" DATETIME,
    "gender" TEXT NOT NULL,
    "contactNo" TEXT NOT NULL,
    "whatsappNo" TEXT NOT NULL,
    "address" TEXT,
    "classId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "academicYearId" INTEGER NOT NULL,
    "photoPath" TEXT,
    "notes" TEXT,
    "legacyBillNo" TEXT,
    "feeOverrideAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Student_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Student_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Student" ("academicYearId", "address", "admissionNo", "classId", "contactNo", "createdAt", "dateOfBirth", "fatherName", "feeOverrideAmount", "fullName", "gender", "id", "legacyBillNo", "notes", "photoPath", "status", "updatedAt", "whatsappNo") SELECT "academicYearId", "address", "admissionNo", "classId", "contactNo", "createdAt", "dateOfBirth", "fatherName", "feeOverrideAmount", "fullName", "gender", "id", "legacyBillNo", "notes", "photoPath", "status", "updatedAt", "whatsappNo" FROM "Student";
DROP TABLE "Student";
ALTER TABLE "new_Student" RENAME TO "Student";
CREATE UNIQUE INDEX "Student_admissionNo_key" ON "Student"("admissionNo");
CREATE INDEX "Student_classId_idx" ON "Student"("classId");
CREATE INDEX "Student_categoryId_idx" ON "Student"("categoryId");
CREATE INDEX "Student_academicYearId_idx" ON "Student"("academicYearId");
CREATE INDEX "Student_status_idx" ON "Student"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "_CategoryToClass_AB_unique" ON "_CategoryToClass"("A", "B");

-- CreateIndex
CREATE INDEX "_CategoryToClass_B_index" ON "_CategoryToClass"("B");
