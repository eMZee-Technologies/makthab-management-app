import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingRows, ErrorState, EmptyState } from '@/components/QueryState';
import { Pagination, DEFAULT_PAGE_SIZE } from '@/components/Pagination';
import { useSort } from '@/components/SortableTableHead';
import { useToast } from '@/components/ui/use-toast';
import { AuditFilters } from './AuditFilters';
import { AuditLogTable } from './AuditLogTable';
import { AuditLogDetail } from './AuditLogDetail';
import { useAuditIntegrity, useAuditLogs, type AuditLogListParams } from './api';

export function AuditLogsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [filters, setFilters] = useState<AuditLogListParams>({
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
  });
  const { sort, toggle } = useSort({ sortBy: 'timestamp', sortOrder: 'desc' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkIntegrity, setCheckIntegrity] = useState(false);

  const queryParams = useMemo(
    () => ({
      ...filters,
      sortBy: sort.sortBy || 'timestamp',
      sortOrder: sort.sortOrder,
    }),
    [filters, sort],
  );

  const { data, isLoading, isError, refetch } = useAuditLogs(queryParams);
  const integrity = useAuditIntegrity(checkIntegrity);

  const selected = data?.items.find((i) => i.id === selectedId) ?? null;

  const onSort = (key: string) => {
    toggle(key);
    setFilters((f) => ({ ...f, page: 1 }));
  };

  const runIntegrity = async () => {
    setCheckIntegrity(true);
    const result = await integrity.refetch();
    const body = result.data;
    if (!body) {
      toast({ title: t('audit.integrityFailed'), variant: 'destructive' });
      return;
    }
    toast({
      title: body.ok ? t('audit.integrityOk') : t('audit.integrityBroken'),
      description: body.message,
      variant: body.ok ? 'default' : 'destructive',
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void runIntegrity()}>
            <ShieldCheck className="me-2 h-4 w-4" />
            {t('audit.verifyIntegrity')}
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <AuditFilters value={filters} onChange={setFilters} />

          {isLoading && <LoadingRows rows={8} />}
          {isError && <ErrorState onRetry={() => refetch()} />}
          {!isLoading && !isError && (data?.items.length ?? 0) === 0 && (
            <EmptyState message={t('audit.empty')} />
          )}
          {!isLoading && !isError && (data?.items.length ?? 0) > 0 && (
            <>
              <AuditLogTable
                items={data!.items}
                sortBy={queryParams.sortBy!}
                sortOrder={queryParams.sortOrder!}
                onSort={onSort}
                onSelect={setSelectedId}
                selectedId={selectedId}
              />
              <Pagination
                page={filters.page ?? 1}
                limit={filters.limit ?? DEFAULT_PAGE_SIZE}
                total={data!.total}
                onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
                onLimitChange={(limit) => setFilters((f) => ({ ...f, limit, page: 1 }))}
              />
            </>
          )}
        </CardContent>
      </Card>

      <AuditLogDetail
        id={selectedId}
        fallback={selected}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
