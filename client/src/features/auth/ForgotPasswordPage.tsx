import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/form/Field';
import { Spinner } from '@/components/ui/spinner';
import { LocaleToggle } from '@/components/layout/LocaleToggle';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/api/client';
import { useForgotPassword, useVerifyOtp, useResetPassword } from './api';

type Step = 'identify' | 'otp' | 'reset' | 'done';

export function ForgotPasswordPage() {
  const isAuthed = useAuthStore((s) => s.isAuthenticated());
  const forgot = useForgotPassword();
  const verify = useVerifyOtp();
  const reset = useResetPassword();

  const [step, setStep] = useState<Step>('identify');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');

  const { register, handleSubmit } = useForm<{ username: string }>({
    defaultValues: { username: '' },
  });

  if (isAuthed) return <Navigate to="/" replace />;

  const err =
    (forgot.isError && extractApiError(forgot.error).message) ||
    (verify.isError && extractApiError(verify.error).message) ||
    (reset.isError && extractApiError(reset.error).message) ||
    null;

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
          <CardTitle>Reset password</CardTitle>
          <CardDescription>
            {step === 'done'
              ? 'Password updated. You can sign in.'
              : 'We will send a verification code if the account exists.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'identify' && (
            <form
              className="space-y-4"
              onSubmit={handleSubmit((values) => {
                forgot.mutate(values, {
                  onSuccess: (data) => {
                    setChallengeId(data.challengeId);
                    if (data.devOtp) setOtp(data.devOtp);
                    // Even when challengeId is null (unknown account), advance so
                    // the UI does not leak whether the account exists.
                    setStep(data.challengeId ? 'otp' : 'done');
                  },
                });
              })}
            >
              <Field label="Username" htmlFor="username">
                <Input id="username" autoComplete="username" {...register('username', { required: true })} />
              </Field>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit" className="w-full" disabled={forgot.isPending}>
                {forgot.isPending && <Spinner className="me-2" />}
                Continue
              </Button>
            </form>
          )}

          {step === 'otp' && challengeId && (
            <>
              <Field label="Verification code" htmlFor="otp">
                <Input
                  id="otp"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              </Field>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button
                className="w-full"
                disabled={verify.isPending || otp.length !== 6}
                onClick={() =>
                  verify.mutate(
                    { challengeId, code: otp },
                    {
                      onSuccess: (data) => {
                        if (data.resetToken) {
                          setResetToken(data.resetToken);
                          setStep('reset');
                        }
                      },
                    }
                  )
                }
              >
                {verify.isPending && <Spinner className="me-2" />}
                Verify
              </Button>
            </>
          )}

          {step === 'reset' && resetToken && (
            <>
              <Field label="New password" htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button
                className="w-full"
                disabled={reset.isPending || password.length < 8}
                onClick={() =>
                  reset.mutate(
                    { resetToken, password },
                    { onSuccess: () => setStep('done') }
                  )
                }
              >
                {reset.isPending && <Spinner className="me-2" />}
                Update password
              </Button>
            </>
          )}

          {step === 'done' && (
            <Button asChild className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          )}

          <p className="text-center text-sm text-muted-foreground">
            <Link className="text-primary underline-offset-4 hover:underline" to="/login">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
