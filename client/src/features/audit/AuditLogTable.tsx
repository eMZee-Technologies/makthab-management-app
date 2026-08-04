import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SortableTableHead } from '@/components/SortableTableHead';
import type { AuditLogDto } from '@makthab/shared';

type Props = {
  items: AuditLogDto[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSort: (key: string) => void;
  onSelect: (id: string) => void;
  selectedId?: string | null;
};

function formatTs(ts: string | Date) {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return d.toLocaleString();
}

export function AuditLogTable({ items, sortBy, sortOrder, onSort, onSelect, selectedId }: Props) {
  const { t } = useTranslation();
  const sort = { sortBy, sortOrder };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableTableHead sortKey="timestamp" sort={sort} onSort={onSort}>
            {t('audit.timestamp')}
          </SortableTableHead>
          <SortableTableHead sortKey="userId" sort={sort} onSort={onSort}>
            {t('audit.user')}
          </SortableTableHead>
          <SortableTableHead sortKey="action" sort={sort} onSort={onSort}>
            {t('audit.action')}
          </SortableTableHead>
          <SortableTableHead sortKey="entity" sort={sort} onSort={onSort}>
            {t('audit.entity')}
          </SortableTableHead>
          <TableHead>{t('audit.resourceId')}</TableHead>
          <SortableTableHead sortKey="outcome" sort={sort} onSort={onSort}>
            {t('audit.outcome')}
          </SortableTableHead>
          <TableHead>{t('audit.ip')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row) => (
          <TableRow
            key={row.id}
            className={`cursor-pointer ${selectedId === row.id ? 'bg-muted/60' : ''}`}
            onClick={() => onSelect(row.id)}
          >
            <TableCell className="whitespace-nowrap text-sm">{formatTs(row.timestamp)}</TableCell>
            <TableCell className="text-sm">
              {row.username ?? (row.userId != null ? `#${row.userId}` : '—')}
            </TableCell>
            <TableCell className="font-mono text-xs">{row.action}</TableCell>
            <TableCell className="font-mono text-xs">{row.entity}</TableCell>
            <TableCell className="font-mono text-xs">{row.resourceId ?? '—'}</TableCell>
            <TableCell>
              <Badge variant={row.outcome === 'success' ? 'secondary' : 'destructive'}>
                {row.outcome}
              </Badge>
            </TableCell>
            <TableCell className="max-w-[8rem] truncate text-xs text-muted-foreground">
              {row.ipAddress ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
