import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import {
  RESOURCE_CATALOG,
  ACTIONS,
  effectiveResourceMatrix,
  type Action,
  type ResourceKey,
  type RolePermissions,
} from '@makthab/shared';
import { Badge } from '@/components/ui/badge';
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
  permissionMatrix: RolePermissions;
  isFullAccess?: boolean;
  className?: string;
}

const ACTION_I18N: Record<Action, string> = {
  view: 'roles.actionView',
  create: 'roles.actionCreate',
  update: 'roles.actionUpdate',
  delete: 'roles.actionDelete',
};

/**
 * Phase 1 read-only resource × action permission matrix.
 * Supported actions per resource come from RESOURCE_CATALOG; unsupported
 * cells render as muted "—" (N/A).
 */
export function PermissionMatrix({ permissionMatrix, isFullAccess, className }: Props) {
  const { t } = useTranslation();
  const matrix = effectiveResourceMatrix(permissionMatrix);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{t('roles.matrixTitle')}</p>
        {isFullAccess && (
          <Badge variant="secondary" title={t('roles.fullAccessHint')}>
            <Lock className="me-1 h-3 w-3" />
            {t('roles.fullAccess')}
          </Badge>
        )}
        {permissionMatrix.mode === 'matrix' && permissionMatrix.inheritsFromAdmin && (
          <Badge variant="outline">{t('roles.inheritsFromAdmin')}</Badge>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[8rem]">{t('roles.resource')}</TableHead>
              {ACTIONS.map((action) => (
                <TableHead key={action} className="w-20 text-center">
                  {t(ACTION_I18N[action])}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {RESOURCE_CATALOG.map((resource) => {
              const row = matrix[resource.key as ResourceKey];
              const supported = new Set(resource.actions as readonly Action[]);
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
      {!isFullAccess && (
        <p className="text-xs text-muted-foreground">{t('roles.matrixReadOnlyHint')}</p>
      )}
    </div>
  );
}
