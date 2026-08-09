import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Plus, FileText, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { Pagination, DEFAULT_PAGE_SIZE } from '@/components/Pagination';
import { SortableTableHead, useSort } from '@/components/SortableTableHead';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/form/Field';
import { CurrencyInput } from '@/components/form/CurrencyInput';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency, formatDate, monthName } from '@/lib/format';
import { extractApiError } from '@/api/client';
import { openWhatsApp } from '@/lib/download';
import { useCan } from '@/lib/permissions';
import { defaulterUpdateSchema, type DefaulterUpdateInput } from '@/lib/schemas';
import {
  useFees,
  useDefaulters,
  useUpdateDefaulter,
  useDeleteFee,
  useSendReceiptWhatsApp,
  downloadReceipt,
  useContributions,
  useDeleteContribution,
  useSendContributionWhatsApp,
  downloadContributionReceipt,
} from './api';
import { FeeForm } from './FeeForm';
import { ContributionForm } from './ContributionForm';
import { FeeStructures } from './FeeStructures';
import type { FeePayment, Defaulter, Contribution } from '@/types/domain';

const now = new Date();

function MonthYearPicker({
  month,
  year,
  onMonth,
  onYear,
}: {
  month: number;
  year: number;
  onMonth: (m: number) => void;
  onYear: (y: number) => void;
}) {
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
  return (
    <div className="flex gap-2">
      <Select value={String(month)} onValueChange={(v) => onMonth(Number(v))}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => (
            <SelectItem key={i + 1} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(year)} onValueChange={(v) => onYear(Number(v))}>
        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent>
          {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function AdmissionYearPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t('fees.allYears')}</SelectItem>
        {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * Shared payments table used by both the Monthly and Admission tabs. The caller
 * supplies the fee-type filter and its own picker controls; this component owns
 * the paging, sorting, and edit/delete flow so neither tab duplicates it.
 */
function PaymentsTable({
  feeType,
  month,
  year,
  filters,
}: {
  feeType: 'monthly' | 'admission';
  month?: number;
  year?: number;
  filters: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const can = useCan();
  const canUpdate = can('fees', 'update');
  const canDelete = can('fees', 'delete');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [editing, setEditing] = useState<FeePayment | null>(null);
  const [deleting, setDeleting] = useState<FeePayment | null>(null);
  const { sort, toggle } = useSort({ sortBy: '', sortOrder: 'asc' });
  const del = useDeleteFee();
  const sendWhatsApp = useSendReceiptWhatsApp();

  // Reset to the first page whenever the filter selection changes.
  useEffect(() => {
    setPage(1);
  }, [feeType, month, year]);

  const { data, isLoading, isError, refetch } = useFees({
    feeType,
    month,
    year,
    page,
    limit,
    sortBy: sort.sortBy || undefined,
    sortOrder: sort.sortBy ? sort.sortOrder : undefined,
  });

  const onSort = (key: string) => {
    toggle(key);
    setPage(1);
  };

  const receipt = async (f: FeePayment) => {
    try {
      await downloadReceipt(f);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  const whatsapp = async (f: FeePayment) => {
    try {
      const result = await sendWhatsApp.mutateAsync(f.id);
      if (result.mode === 'walink') {
        // wa.me can't attach files itself — download the PDF so the staff
        // member has it locally, then open the pre-filled chat to attach it.
        await downloadReceipt(f);
        window.open(result.link, '_blank', 'noopener,noreferrer');
      }
      toast({ title: t('fees.whatsapp'), variant: 'success' });
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('fees.deleted'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-2">
          {filters}
          {data && (
            <div className="text-sm text-muted-foreground">
              {t('common.total')}:{' '}
              <span className="font-semibold text-foreground">
                {formatCurrency(data.totalPaid, i18n.language)}
              </span>
            </div>
          )}
        </div>
        {isLoading ? (
          <LoadingRows cols={8} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sortKey="admissionNo" sort={sort} onSort={onSort}>
                  {t('students.admissionNo')}
                </SortableTableHead>
                <SortableTableHead sortKey="student" sort={sort} onSort={onSort}>
                  {t('fees.student')}
                </SortableTableHead>
                <SortableTableHead sortKey="feeType" sort={sort} onSort={onSort}>
                  {t('fees.feeType')}
                </SortableTableHead>
                <SortableTableHead sortKey="amountPaid" sort={sort} onSort={onSort} className="text-end">
                  {t('fees.amountPaid')}
                </SortableTableHead>
                <SortableTableHead sortKey="paymentDate" sort={sort} onSort={onSort}>
                  {t('fees.paymentDate')}
                </SortableTableHead>
                <SortableTableHead sortKey="receiptNo" sort={sort} onSort={onSort}>
                  {t('fees.receiptNo')}
                </SortableTableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.student?.admissionNo ?? '-'}</TableCell>
                  <TableCell>{f.student?.fullName ?? f.studentId}</TableCell>
                  <TableCell className="capitalize">{f.feeType}</TableCell>
                  <TableCell className="text-end">{formatCurrency(f.amountPaid, i18n.language)}</TableCell>
                  <TableCell>{formatDate(f.paymentDate, i18n.language)}</TableCell>
                  <TableCell>{f.receiptNo}</TableCell>
                  <TableCell>
                    <Badge variant={f.amountPaid >= f.amountDue ? 'success' : 'warning'}>
                      {f.amountPaid >= f.amountDue ? t('fees.paid') : t('fees.unpaid')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title={t('fees.receipt')} onClick={() => receipt(f)}>
                        <FileText className="h-4 w-4" />
                      </Button>
                      {canUpdate && (
                        <Button variant="ghost" size="icon" title={t('fees.whatsapp')} onClick={() => whatsapp(f)}>
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      {canUpdate && (
                        <Button variant="ghost" size="icon" title={t('common.edit')} onClick={() => setEditing(f)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="icon" title={t('common.delete')} onClick={() => setDeleting(f)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data && data.total > 0 && (
          <Pagination
            page={page}
            limit={limit}
            total={data.total}
            onPageChange={setPage}
            onLimitChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        )}
      </CardContent>

      <FeeForm
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        fee={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        title={t('fees.confirmDeleteTitle')}
        message={t('fees.confirmDelete', {
          receipt: deleting?.receiptNo ?? '',
          name: deleting?.student?.fullName ?? '',
        })}
        confirmLabel={t('common.delete')}
        destructive
        pending={del.isPending}
      />
    </Card>
  );
}

function MonthlyTab() {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  return (
    <PaymentsTable
      feeType="monthly"
      month={month}
      year={year}
      filters={<MonthYearPicker month={month} year={year} onMonth={setMonth} onYear={setYear} />}
    />
  );
}

function AdmissionTab() {
  const [year, setYear] = useState<string>('all');
  return (
    <PaymentsTable
      feeType="admission"
      year={year === 'all' ? undefined : Number(year)}
      filters={<AdmissionYearPicker value={year} onChange={setYear} />}
    />
  );
}

function ContributionsTab() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const can = useCan();
  const canCreate = can('fees', 'create');
  const canUpdate = can('fees', 'update');
  const canDelete = can('fees', 'delete');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [year, setYear] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contribution | null>(null);
  const [deleting, setDeleting] = useState<Contribution | null>(null);
  const { sort, toggle } = useSort({ sortBy: '', sortOrder: 'asc' });
  const del = useDeleteContribution();
  const sendWhatsApp = useSendContributionWhatsApp();

  useEffect(() => {
    setPage(1);
  }, [year]);

  const { data, isLoading, isError, refetch } = useContributions({
    year: year === 'all' ? undefined : Number(year),
    page,
    limit,
    sortBy: sort.sortBy || undefined,
    sortOrder: sort.sortBy ? sort.sortOrder : undefined,
  });

  const onSort = (key: string) => {
    toggle(key);
    setPage(1);
  };

  const receipt = async (c: Contribution) => {
    try {
      await downloadContributionReceipt(c);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  const whatsapp = async (c: Contribution) => {
    try {
      const result = await sendWhatsApp.mutateAsync(c.id);
      if (result.mode === 'walink') {
        await downloadContributionReceipt(c);
        window.open(result.link, '_blank', 'noopener,noreferrer');
      }
      toast({ title: t('fees.whatsapp'), variant: 'success' });
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: t('fees.contributionDeleted'), variant: 'success' });
        setDeleting(null);
      },
      onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
    });
  };

  const typeLabel = (type: Contribution['contributorType']) =>
    type === 'anonymous' ? t('fees.contributorAnonymous') : t('fees.contributorIndividual');

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdmissionYearPicker value={year} onChange={setYear} />
          <div className="flex items-center gap-3">
            {data && (
              <div className="text-sm text-muted-foreground">
                {t('common.total')}:{' '}
                <span className="font-semibold text-foreground">
                  {formatCurrency(data.totalAmount, i18n.language)}
                </span>
              </div>
            )}
            {canCreate && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('fees.addContribution')}
              </Button>
            )}
          </div>
        </div>
        {isLoading ? (
          <LoadingRows cols={7} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sortKey="receiptNo" sort={sort} onSort={onSort}>
                  {t('fees.receiptNo')}
                </SortableTableHead>
                <SortableTableHead sortKey="contributorName" sort={sort} onSort={onSort}>
                  {t('fees.contributorName')}
                </SortableTableHead>
                <SortableTableHead sortKey="contributorType" sort={sort} onSort={onSort}>
                  {t('fees.contributorType')}
                </SortableTableHead>
                <SortableTableHead sortKey="date" sort={sort} onSort={onSort}>
                  {t('fees.contributionDate')}
                </SortableTableHead>
                <SortableTableHead sortKey="amount" sort={sort} onSort={onSort} className="text-end">
                  {t('fees.contributionAmount')}
                </SortableTableHead>
                <TableHead>{t('fees.contributionNotes')}</TableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.receiptNo}</TableCell>
                  <TableCell>{c.contributorName}</TableCell>
                  <TableCell>{typeLabel(c.contributorType)}</TableCell>
                  <TableCell>{formatDate(c.date, i18n.language)}</TableCell>
                  <TableCell className="text-end">{formatCurrency(c.amount, i18n.language)}</TableCell>
                  <TableCell className="max-w-[12rem] truncate">{c.notes ?? '-'}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title={t('fees.receipt')} onClick={() => receipt(c)}>
                        <FileText className="h-4 w-4" />
                      </Button>
                      {canUpdate && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('fees.whatsapp')}
                          onClick={() => whatsapp(c)}
                        >
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      {canUpdate && (
                        <Button variant="ghost" size="icon" title={t('common.edit')} onClick={() => setEditing(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="icon" title={t('common.delete')} onClick={() => setDeleting(c)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data && data.total > 0 && (
          <Pagination
            page={page}
            limit={limit}
            total={data.total}
            onPageChange={setPage}
            onLimitChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        )}
      </CardContent>

      <ContributionForm
        open={formOpen || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(null);
          }
        }}
        contribution={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={confirmDelete}
        title={t('fees.confirmDeleteContributionTitle')}
        message={t('fees.confirmDeleteContribution', {
          receipt: deleting?.receiptNo ?? '',
          name: deleting?.contributorName ?? '',
        })}
        confirmLabel={t('common.delete')}
        destructive
        pending={del.isPending}
      />
    </Card>
  );
}

function DefaulterEditDialog({
  defaulter,
  open,
  onOpenChange,
}: {
  defaulter: Defaulter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const update = useUpdateDefaulter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DefaulterUpdateInput>({
    resolver: zodResolver(defaulterUpdateSchema),
  });

  useEffect(() => {
    if (open && defaulter) reset({ amountDue: defaulter.amountDue });
  }, [open, defaulter, reset]);

  const onSubmit = handleSubmit((values) => {
    if (!defaulter) return;
    update.mutate(
      { studentId: defaulter.studentId, amountDue: values.amountDue },
      {
        onSuccess: () => {
          toast({ title: t('fees.amountDueUpdated'), variant: 'success' });
          onOpenChange(false);
        },
        onError: (err) => toast({ title: extractApiError(err).message, variant: 'destructive' }),
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('fees.editAmountDue')}</DialogTitle>
          <DialogDescription>{defaulter?.fullName}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('fees.amountDue')} error={errors.amountDue?.message} required>
            <CurrencyInput step="0.01" autoFocus {...register('amountDue')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Spinner className="me-2" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DefaultersTab() {
  const { t, i18n } = useTranslation();
  const can = useCan();
  const canUpdate = can('fees', 'update');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [editing, setEditing] = useState<Defaulter | null>(null);
  const { sort, toggle } = useSort({ sortBy: 'admissionNo', sortOrder: 'asc' });

  useEffect(() => {
    setPage(1);
  }, [month, year]);

  const { data, isLoading, isError, refetch } = useDefaulters({
    month,
    year,
    page,
    limit,
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
  });

  const onSort = (key: string) => {
    toggle(key);
    setPage(1);
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <MonthYearPicker month={month} year={year} onMonth={setMonth} onYear={setYear} />
        {isLoading ? (
          <LoadingRows cols={4} />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sortKey="admissionNo" sort={sort} onSort={onSort}>
                  {t('students.admissionNo')}
                </SortableTableHead>
                <SortableTableHead sortKey="fullName" sort={sort} onSort={onSort}>
                  {t('students.fullName')}
                </SortableTableHead>
                <SortableTableHead sortKey="amountDue" sort={sort} onSort={onSort} className="text-end">
                  {t('fees.amountDue')}
                </SortableTableHead>
                <TableHead className="text-end">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((d) => (
                <TableRow key={d.studentId}>
                  <TableCell className="font-medium">{d.admissionNo}</TableCell>
                  <TableCell>{d.fullName}</TableCell>
                  <TableCell className="text-end">{formatCurrency(d.amountDue, i18n.language)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {d.whatsappNo && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('fees.whatsapp')}
                          onClick={() =>
                            openWhatsApp(
                              d.whatsappNo!,
                              t('fees.defaulterWhatsapp', {
                                amount: formatCurrency(d.amountDue, i18n.language),
                                name: d.fullName,
                                month: monthName(month),
                                year,
                              }),
                            )
                          }
                        >
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      {canUpdate && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('common.edit')}
                          onClick={() => setEditing(d)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data && data.total > 0 && (
          <Pagination
            page={page}
            limit={limit}
            total={data.total}
            onPageChange={setPage}
            onLimitChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
          />
        )}
      </CardContent>

      <DefaulterEditDialog
        defaulter={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </Card>
  );
}

export function FeesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const canCreate = can('fees', 'create');
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t('fees.title')}
        actions={
          canCreate && (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('fees.collect')}
            </Button>
          )
        }
      />
      <Tabs defaultValue="monthly">
        <TabsList>
          <TabsTrigger value="monthly">{t('fees.monthly')}</TabsTrigger>
          <TabsTrigger value="admission">{t('fees.admission')}</TabsTrigger>
          <TabsTrigger value="contributions">{t('fees.contributions')}</TabsTrigger>
          <TabsTrigger value="defaulters">{t('fees.defaulters')}</TabsTrigger>
          <TabsTrigger value="structures">{t('fees.structures')}</TabsTrigger>
        </TabsList>
        <TabsContent value="monthly"><MonthlyTab /></TabsContent>
        <TabsContent value="admission"><AdmissionTab /></TabsContent>
        <TabsContent value="contributions"><ContributionsTab /></TabsContent>
        <TabsContent value="defaulters"><DefaultersTab /></TabsContent>
        <TabsContent value="structures"><FeeStructures /></TabsContent>
      </Tabs>
      <FeeForm open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
