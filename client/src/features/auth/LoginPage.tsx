import { useForm } from 'react-hook-form';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/form/Field';
import { Spinner } from '@/components/ui/spinner';
import { useLogin, type LoginInput } from './api';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/api/client';
import { LocaleToggle } from '@/components/layout/LocaleToggle';

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
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="absolute end-4 top-4">
        <LocaleToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <GraduationCap className="h-6 w-6" />
          </div>
          <CardTitle>{t('auth.loginTitle')}</CardTitle>
          <CardDescription>{t('auth.loginSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label={t('auth.username')} htmlFor="username" error={errors.username?.message}>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                {...register('username', { required: true })}
              />
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
        </CardContent>
      </Card>
    </div>
  );
}
