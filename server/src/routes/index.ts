import { Router } from "express";
import { authRouter } from "./auth";
import { studentsRouter } from "./students";
import { feesRouter } from "./fees";
import { attendanceRouter } from "./attendance";
import { expensesRouter, staffRouter, salariesRouter } from "./finance";
import { reportsRouter } from "./reports";
import { referenceRouter } from "./reference";
import { classesRouter } from "./classes";
import { dashboardRouter } from "./dashboard";
import { adminRouter } from "./admin";
import { usersRouter } from "./users";
import { orgProfileRouter } from "./orgProfile";
import { rolesRouter } from "./roles";
import { categoriesRouter } from "./categories";

// Aggregate router for /api/v1. Every domain from doc §6 is mounted here.
export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/students", studentsRouter);
apiRouter.use("/fees", feesRouter);
apiRouter.use("/attendance", attendanceRouter);
apiRouter.use("/expenses", expensesRouter);
apiRouter.use("/staff", staffRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/salaries", salariesRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/classes", classesRouter);
apiRouter.use("/org-profile", orgProfileRouter);
apiRouter.use("/roles", rolesRouter);
apiRouter.use("/categories", categoriesRouter);

// Reference/lookup endpoints (classes, academic-years, expense-categories)
// live at the /api/v1 root.
apiRouter.use("/", referenceRouter);
