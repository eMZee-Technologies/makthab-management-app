import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { downloadFile } from '@/lib/download';
import type { FeePayment, Defaulter, FeeStructure, Contribution } from '@/types/domain';
import type { FeePaymentCreateInput, FeeStructureCreateInput, ContributionCreateInput } from '@/lib/schemas';

export interface FeeListParams {
  student_id?: number;
  feeType?: 'admission' | 'monthly' | 'annual' | 'other';
  month?: number;
  year?: number;
  status?: 'paid' | 'unpaid';
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const p = data as { items?: T[] };
  return p.items ?? [];
}

export function useFees(params: FeeListParams = {}) {
  return useQuery({
    queryKey: ['fees', params],
    queryFn: async () => {
      const payload = unwrap((await api.get('/fees', { params })).data) as {
        items?: FeePayment[];
        total?: number;
        totalPaid?: number;
      };
      return {
        items: payload.items ?? [],
        total: payload.total ?? payload.items?.length ?? 0,
        totalPaid: payload.totalPaid ?? 0,
      };
    },
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FeePaymentCreateInput) =>
      unwrap<FeePayment>((await api.post('/fees', input)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fees'] });
      qc.invalidateQueries({ queryKey: ['fees', 'defaulters'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateFee(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<FeePaymentCreateInput>) =>
      unwrap<FeePayment>((await api.patch(`/fees/${id}`, input)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fees'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/fees/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fees'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export interface DefaultersParams {
  month: number;
  year: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useDefaulters(params: DefaultersParams) {
  return useQuery({
    queryKey: ['fees', 'defaulters', params],
    queryFn: async () => {
      const payload = unwrap((await api.get('/fees/defaulters', { params })).data) as {
        items?: Defaulter[];
        total?: number;
      };
      return {
        items: payload.items ?? [],
        total: payload.total ?? payload.items?.length ?? 0,
      };
    },
  });
}

export function useUpdateDefaulter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ studentId, amountDue }: { studentId: number; amountDue: number }) =>
      unwrap<Defaulter>((await api.patch(`/fees/defaulters/${studentId}`, { amountDue })).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fees', 'defaulters'] }),
  });
}

export function useFeeStructures() {
  return useQuery({
    queryKey: ['fees', 'structures'],
    queryFn: async () => toArray<FeeStructure>(unwrap((await api.get('/fees/structures')).data)),
  });
}

export function useSaveFeeStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FeeStructureCreateInput) =>
      unwrap<FeeStructure>((await api.post('/fees/structures', input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fees', 'structures'] }),
  });
}

export function useDeleteFeeStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/fees/structures/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fees', 'structures'] }),
  });
}

export function downloadReceipt(fee: FeePayment) {
  return downloadFile(`/fees/${fee.id}/receipt`, `receipt-${fee.receiptNo}.pdf`);
}

/**
 * Ask the server to send the receipt via WhatsApp and mark it sent. The
 * server 409s if it was already sent — the caller's error handler surfaces
 * that message as-is.
 *
 * Two response shapes depending on the server's configured gateway:
 *   mode: "walink" — can't attach files itself, so the caller must download
 *     the receipt PDF and open `link` (a wa.me chat) for manual attach.
 *   mode: "business-api" — the server already sent the PDF directly; nothing
 *     more for the caller to do.
 */
export function useSendReceiptWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (feeId: number) =>
      unwrap<{ mode: 'walink'; link: string; whatsappSent: boolean } | { mode: 'business-api'; whatsappSent: boolean }>(
        (await api.post(`/fees/${feeId}/whatsapp`)).data,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fees'] }),
  });
}

export interface ContributionListParams {
  year?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function useContributions(params: ContributionListParams = {}) {
  return useQuery({
    queryKey: ['contributions', params],
    queryFn: async () => {
      const payload = unwrap((await api.get('/contributions', { params })).data) as {
        items?: Contribution[];
        total?: number;
        totalAmount?: number;
      };
      return {
        items: payload.items ?? [],
        total: payload.total ?? payload.items?.length ?? 0,
        totalAmount: payload.totalAmount ?? 0,
      };
    },
  });
}

export function useCreateContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContributionCreateInput) =>
      unwrap<Contribution>((await api.post('/contributions', input)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateContribution(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<ContributionCreateInput>) =>
      unwrap<Contribution>((await api.patch(`/contributions/${id}`, input)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/contributions/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contributions'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function downloadContributionReceipt(c: Contribution) {
  return downloadFile(`/contributions/${c.id}/receipt`, `contribution-${c.receiptNo}.pdf`);
}

export function useSendContributionWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap<{ mode: 'walink'; link: string; whatsappSent: boolean } | { mode: 'business-api'; whatsappSent: boolean }>(
        (await api.post(`/contributions/${id}/whatsapp`)).data,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contributions'] }),
  });
}
