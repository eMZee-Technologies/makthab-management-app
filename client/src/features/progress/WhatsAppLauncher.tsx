import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/use-toast';
import { extractApiError } from '@/api/client';
import type { MonthlyProgress, Student } from '@/types/domain';
import { useSendProgressWhatsApp } from './api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
  progress: MonthlyProgress;
}

/**
 * Confirms privacy note, then POSTs /progress/:id/whatsapp and opens the
 * returned wa.me link (message template filled server-side).
 */
export function WhatsAppLauncher({ open, onOpenChange, student, progress }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const send = useSendProgressWhatsApp();

  const onSend = async () => {
    try {
      const result = await send.mutateAsync(progress.id);
      if (result.link) {
        window.open(result.link, '_blank', 'noopener,noreferrer');
      }
      toast({ title: t('progress.whatsappSent'), variant: 'success' });
      onOpenChange(false);
    } catch (err) {
      toast({ title: extractApiError(err).message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('progress.whatsappTitle')}</DialogTitle>
          <DialogDescription>{t('progress.whatsappPrivacy')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">{t('progress.studentName')}: </span>
            {student.fullName}
          </p>
          <p>
            <span className="text-muted-foreground">{t('students.whatsappNo')}: </span>
            {student.whatsappNo || t('progress.noWhatsapp')}
          </p>
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {t('progress.whatsappTemplateHint')}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void onSend()}
            disabled={send.isPending || !student.whatsappNo}
          >
            {send.isPending && <Spinner className="me-2 h-4 w-4" />}
            {t('progress.sendWhatsapp')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
