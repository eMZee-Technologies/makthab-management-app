import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_OUTCOMES } from '@makthab/shared';
import type { AuditLogListParams } from './api';

type Props = {
  value: AuditLogListParams;
  onChange: (next: AuditLogListParams) => void;
};

export function AuditFilters({ value, onChange }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<AuditLogListParams>) => onChange({ ...value, ...patch, page: 1 });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <div className="space-y-1">
        <Label htmlFor="audit-from">{t('audit.from')}</Label>
        <Input
          id="audit-from"
          type="date"
          value={value.from?.slice(0, 10) ?? ''}
          onChange={(e) => set({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-to">{t('audit.to')}</Label>
        <Input
          id="audit-to"
          type="date"
          value={value.to?.slice(0, 10) ?? ''}
          onChange={(e) => {
            if (!e.target.value) {
              set({ to: undefined });
              return;
            }
            const d = new Date(e.target.value);
            d.setHours(23, 59, 59, 999);
            set({ to: d.toISOString() });
          }}
        />
      </div>
      <div className="space-y-1">
        <Label>{t('audit.action')}</Label>
        <Select
          value={value.action ?? 'all'}
          onValueChange={(v) => set({ action: v === 'all' ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('audit.allActions')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('audit.allActions')}</SelectItem>
            {AUDIT_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>{t('audit.entity')}</Label>
        <Select
          value={value.entity ?? 'all'}
          onValueChange={(v) => set({ entity: v === 'all' ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('audit.allEntities')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('audit.allEntities')}</SelectItem>
            {AUDIT_ENTITIES.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>{t('audit.outcome')}</Label>
        <Select
          value={value.outcome ?? 'all'}
          onValueChange={(v) =>
            set({ outcome: v === 'all' ? undefined : (v as 'success' | 'failure') })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={t('audit.allOutcomes')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('audit.allOutcomes')}</SelectItem>
            {AUDIT_OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-user">{t('audit.userId')}</Label>
        <Input
          id="audit-user"
          type="number"
          min={1}
          placeholder={t('audit.userIdPlaceholder')}
          value={value.userId ?? ''}
          onChange={(e) =>
            set({ userId: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </div>
    </div>
  );
}
