import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingRows, ErrorState } from '@/components/QueryState';
import { useAuditLog } from './api';
import type { AuditLogDto } from '@makthab/shared';

type Props = {
  id: string | null;
  onClose: () => void;
  fallback?: AuditLogDto | null;
};

export function AuditLogDetail({ id, onClose, fallback }: Props) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useAuditLog(id);
  const row = data ?? fallback;

  if (!id) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        {t('audit.selectHint')}
      </div>
    );
  }

  if (isLoading && !row) return <LoadingRows rows={4} />;
  if (isError && !row) return <ErrorState onRetry={() => refetch()} />;
  if (!row) return null;

  return (
    <div className="space-y-4 rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{t('audit.detailTitle')}</h3>
          <p className="font-mono text-xs text-muted-foreground">{row.id}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Detail label={t('audit.timestamp')} value={new Date(row.timestamp).toLocaleString()} />
        <Detail
          label={t('audit.user')}
          value={row.username ?? (row.userId != null ? `#${row.userId}` : '—')}
        />
        <Detail label={t('audit.action')} value={row.action} mono />
        <Detail label={t('audit.entity')} value={row.entity} mono />
        <Detail label={t('audit.resourceId')} value={row.resourceId ?? '—'} mono />
        <div>
          <dt className="text-xs text-muted-foreground">{t('audit.outcome')}</dt>
          <dd>
            <Badge variant={row.outcome === 'success' ? 'secondary' : 'destructive'}>
              {row.outcome}
            </Badge>
          </dd>
        </div>
        <Detail label={t('audit.ip')} value={row.ipAddress ?? '—'} />
        <Detail label={t('audit.userAgent')} value={row.userAgent ?? '—'} />
        <Detail label={t('audit.contentHash')} value={row.contentHash} mono />
        <Detail label={t('audit.prevHash')} value={row.prevHash ?? 'GENESIS'} mono />
      </dl>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">{t('audit.details')}</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
          {row.additionalDetails == null
            ? '—'
            : JSON.stringify(row.additionalDetails, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`break-all text-sm ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
