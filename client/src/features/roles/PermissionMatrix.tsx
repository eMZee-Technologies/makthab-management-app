import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import {
  RESOURCE_CATALOG,
  ACTIONS,
  isCellOverride,
  supportedActionsFor,
  type Action,
  type ResourceActions,
  type ResourceKey,
} from '@makthab/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface Props {
  resources: Record<ResourceKey, ResourceActions>;
  inheritsFromAdmin: boolean;
  isFullAccess?: boolean;
  readOnly?: boolean;
  className?: string;
  onToggleCell?: (resource: ResourceKey, action: Action, value: boolean) => void;
  onInheritChange?: (inherits: boolean) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
  onResetBaseline?: () => void;
}

const ACTION_I18N: Record<Action, string> = {
  view: 'roles.actionView',
  create: 'roles.actionCreate',
  update: 'roles.actionUpdate',
  delete: 'roles.actionDelete',
};

/**
 * Resource × action permission matrix.
 * Phase 2: interactive checkboxes for non–full-access roles, with inherit /
 * override indicators and bulk actions.
 */
export function PermissionMatrix({
  resources,
  inheritsFromAdmin,
  isFullAccess,
  readOnly,
  className,
  onToggleCell,
  onInheritChange,
  onSelectAll,
  onClearAll,
  onResetBaseline,
}: Props) {
  const { t } = useTranslation();
  const locked = Boolean(readOnly || isFullAccess);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{t('roles.matrixTitle')}</p>
        {isFullAccess && (
          <Badge variant="secondary" title={t('roles.fullAccessHint')}>
            <Lock className="me-1 h-3 w-3" />
            {t('roles.fullAccess')}
          </Badge>
        )}
        {!isFullAccess && inheritsFromAdmin && (
          <Badge variant="outline">{t('roles.inheritsFromAdmin')}</Badge>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={inheritsFromAdmin}
              onChange={(e) => onInheritChange?.(e.target.checked)}
            />
            <span>{t('roles.inheritToggle')}</span>
          </label>
          <div className="ms-auto flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onSelectAll}>
              {t('roles.selectAll')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClearAll}>
              {t('roles.clearAll')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onResetBaseline}>
              {t('roles.resetBaseline')}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[8rem]">{t('roles.resource')}</TableHead>
              {ACTIONS.map((action) => (
                <TableHead key={action} className="w-24 text-center">
                  {t(ACTION_I18N[action])}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {RESOURCE_CATALOG.map((resource) => {
              const row = resources[resource.key as ResourceKey];
              const supported = new Set(supportedActionsFor(resource.key as ResourceKey));
              return (
                <TableRow key={resource.key}>
                  <TableCell>
                    <div className="font-medium">{resource.label}</div>
                    {resource.description && (
                      <div className="text-xs text-muted-foreground">{resource.description}</div>
                    )}
                  </TableCell>
                  {ACTIONS.map((action) => {
                    if (!supported.has(action)) {
                      return (
                        <TableCell
                          key={action}
                          className="text-center text-muted-foreground"
                          title={t('roles.actionNa')}
                        >
                          —
                        </TableCell>
                      );
                    }
                    const allowed = row?.[action] ?? false;
                    const overridden = isCellOverride(
                      resources,
                      resource.key as ResourceKey,
                      action,
                      inheritsFromAdmin,
                    );
                    if (locked) {
                      return (
                        <TableCell key={action} className="text-center">
                          <span
                            className={cn(
                              'inline-flex h-5 w-5 items-center justify-center rounded border text-xs',
                              allowed
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-muted text-muted-foreground',
                            )}
                            aria-label={`${resource.label} ${action}: ${allowed ? 'yes' : 'no'}`}
                          >
                            {allowed ? '✓' : ''}
                          </span>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={action} className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-input accent-primary"
                            checked={allowed}
                            onChange={(e) =>
                              onToggleCell?.(resource.key as ResourceKey, action, e.target.checked)
                            }
                            aria-label={`${resource.label} ${action}`}
                          />
                          {overridden && (
                            <span className="text-[10px] leading-none text-muted-foreground">
                              {t('roles.override')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {isFullAccess && (
        <p className="text-xs text-muted-foreground">{t('roles.fullAccessLocked')}</p>
      )}
      {!locked && inheritsFromAdmin && (
        <p className="text-xs text-muted-foreground">{t('roles.inheritHint')}</p>
      )}
    </div>
  );
}
