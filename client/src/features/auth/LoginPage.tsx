import { useForm } from 'react-hook-form';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/form/Field';
import { Spinner } from '@/components/ui/spinner';
import { AuthShell } from '@/components/layout/AuthShell';
import { useLogin, type LoginInput } from './api';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/api/client';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();
  const isAuthed = useAuthStore((s) => s.isAuthenticated());

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ defaultValues: { username: '', password: '' } });

  if (isAuthed) {
    return <Navigate to="/" replace />;
  }

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: () => navigate(from, { replace: true }),
    });
  });

  const serverError = login.isError ? extractApiError(login.error).message : null;

  return (
    <AuthShell>
      <div className="mb-6 flex items-center gap-2 lg:hidden">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <GraduationCap className="h-4 w-4" />
        </div>
        <p className="font-serif text-lg font-semibold">{t('app.name')}</p>
      </div>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <Field label={t('auth.username')} htmlFor="username" error={errors.username?.message}>
          <Input id="username" autoComplete="username" autoFocus {...register('username', { required: true })} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password', { required: true })}
          />
        </Field>
        {serverError && <p className="text-sm text-destructive">{t('auth.invalidCredentials')}</p>}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending && <Spinner className="me-2" />}
          {login.isPending ? t('auth.signingIn') : t('auth.login')}
        </Button>
        <div className="flex justify-between gap-2 text-sm text-muted-foreground">
          <Link className="text-primary underline-offset-4 hover:underline" to="/register">
            {t('auth.register')}
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" to="/forgot-password">
            {t('auth.forgotPassword')}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
