import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { AcademicYear, Category, Class, ExpenseCategory } from '@/types/domain';
import type { CategoryCreateInput, ClassCreateInput } from '@/lib/schemas';

/**
 * Reference/lookup data used to populate select inputs across forms.
 * Endpoints are lightweight GETs; results are cached aggressively.
 */

export function useClasses() {
  return useQuery({
    queryKey: ['classes'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap<Class[]>((await api.get('/classes')).data),
  });
}

export function useCreateClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClassCreateInput) =>
      unwrap<Class>((await api.post('/classes', input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });
}

export function useUpdateClass(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<ClassCreateInput>) =>
      unwrap<Class>((await api.patch(`/classes/${id}`, input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });
}

export function useDeleteClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/classes/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });
}

export function useAcademicYears() {
  return useQuery({
    queryKey: ['academic-years'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap<AcademicYear[]>((await api.get('/academic-years')).data),
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense-categories'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap<ExpenseCategory[]>((await api.get('/expense-categories')).data),
  });
}

// Class categories (e.g. Noorani Qaida, Hifz Quran) — the global master list
// classes pick from. See ClassForm/CategoriesPage.
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap<Category[]>((await api.get('/categories')).data),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CategoryCreateInput) =>
      unwrap<Category>((await api.post('/categories', input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<CategoryCreateInput>) =>
      unwrap<Category>((await api.patch(`/categories/${id}`, input)).data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/categories/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}
