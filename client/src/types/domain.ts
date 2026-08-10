/**
 * View/response types the client renders. These mirror the API's JSON
 * responses (derived from the Prisma models in doc §7.1). Input/validation
 * schemas for forms are imported from `@makthab/shared` instead.
 */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Category {
  id: number;
  name: string;
}

export interface Class {
  id: number;
  name: string;
  teacherId?: number | null;
  categories: Category[];
}

export interface AcademicYear {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface ExpenseCategory {
  id: number;
  name: string;
}

export interface Student {
  id: number;
  admissionNo: string;
  fullName: string;
  fatherName: string;
  dateOfBirth: string | null;
  gender: string;
  contactNo: string;
  whatsappNo: string;
  address?: string | null;
  classId: number;
  categoryId?: number | null;
  academicYearId: number;
  photoPath?: string | null;
  status: string;
  admissionDate?: string | null;
  class?: Class;
  category?: Category | null;
  academicYear?: AcademicYear;
  createdAt?: string;
}

export interface FeePayment {
  id: number;
  receiptNo: string;
  studentId: number;
  feeType: string;
  feeMonth?: number | null;
  feeYear: number;
  amountDue: number;
  amountPaid: number;
  paymentDate: string;
  paymentMethod: string;
  waiverAmount: number;
  pdfPath?: string | null;
  whatsappSent: boolean;
  student?: Student;
}

export interface Contribution {
  id: number;
  amount: number;
  contributorName: string;
  contributorType: 'individual' | 'anonymous';
  date: string;
  receiptNo: string;
  notes?: string | null;
  whatsappNo?: string | null;
  pdfPath?: string | null;
  whatsappSent: boolean;
  recordedById: number;
  createdAt: string;
}

export interface FeeStructure {
  id: number;
  classId: number;
  categoryId?: number | null;
  academicYearId: number;
  feeType: string;
  amount: number;
  class?: Class;
  category?: Category | null;
}

export interface Defaulter {
  studentId: number;
  fullName: string;
  admissionNo: string;
  className?: string;
  amountDue: number;
  whatsappNo?: string;
}

export interface Attendance {
  id: number;
  studentId: number;
  date: string;
  status: 'present' | 'absent' | 'leave' | string;
  notes?: string | null;
  student?: Student;
}

export interface AttendanceSummaryRow {
  studentId: number;
  fullName: string;
  totalDays: number;
  present: number;
  absent: number;
  percentage: number;
}

export interface Expense {
  id: number;
  voucherNo: string;
  categoryId: number;
  cost?: number | null;
  quantity?: number | null;
  amount: number;
  expenseDate: string;
  payee: string;
  description?: string | null;
  category?: ExpenseCategory;
}

export interface Staff {
  id: number;
  fullName: string;
  role: string;
  baseSalary: number;
  contactNo: string;
  whatsappNo: string;
  photoPath?: string | null;
  signaturePath?: string | null;
  status: string;
}

export interface User {
  id: number;
  username: string;
  email: string | null;
  phone?: string | null;
  role: string;
  status: string;
  staffId: number;
  fullName: string;
  contactNo: string;
  whatsappNo: string;
  address?: string | null;
  photoPath?: string | null;
  signaturePath?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrgProfile {
  id: number;
  name: string;
  address: string;
  headerImagePath?: string | null;
  isActive: boolean;
  updatedAt?: string;
}

export interface SalaryPayment {
  id: number;
  staffId: number;
  salaryMonth: number;
  salaryYear: number;
  grossAmount: number;
  deductions: number;
  netAmount: number;
  paymentDate: string;
  payslipPdfPath?: string | null;
  whatsappSent: boolean;
  staff?: Staff;
}

export interface DashboardStats {
  totalStudents: number;
  todayPresent: number;
  todayAbsent: number;
  monthCollection: number;
  outstanding: number;
  recentActivity?: { id: number; type: string; description: string; date: string }[];
}
