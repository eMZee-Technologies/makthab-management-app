import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { strongPasswordSchema } from '@makthab/shared';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/form/Field';
import { Spinner } from '@/components/ui/spinner';
import { LocaleToggle } from '@/components/layout/LocaleToggle';
import { useAuthStore } from '@/store/authStore';
import { formatApiErrorMessage } from '@/api/client';
import { useSignup, useVerifyOtp } from './api';

const signupFormSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(64),
  email: z.string().trim().email('Enter a valid email'),
  password: strongPasswordSchema,
});
type SignupForm = z.infer<typeof signupFormSchema>;

export function SignupPage() {
  const isAuthed = useAuthStore((s) => s.isAuthenticated());
  const signup = useSignup();
  const verify = useVerifyOtp();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: { fullName: '', username: '', password: '', email: '' },
  });

  if (isAuthed) return <Navigate to="/" replace />;

  const onSignup = handleSubmit((values) => {
    signup.mutate(
      { ...values, otpMethod: 'email' },
      {
        onSuccess: (data) => {
          setChallengeId(data.challengeId);
          if (data.devOtp) setOtp(data.devOtp);
        },
      }
    );
  });

  const onVerify = () => {
    if (!challengeId) return;
    verify.mutate(
      { challengeId, code: otp },
      { onSuccess: () => setDone(true) }
    );
  };

  const err =
    (signup.isError && formatApiErrorMessage(signup.error)) ||
    (verify.isError && formatApiErrorMessage(verify.error)) ||
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
          <CardTitle>Request access</CardTitle>
          <CardDescription>
            {done
              ? 'Verified — an admin will review your account.'
              : challengeId
                ? 'Enter the 6-digit code sent to your email.'
                : 'Register with email. Access starts after admin approval.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {done ? (
            <Button asChild className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          ) : challengeId ? (
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
              <Button className="w-full" onClick={onVerify} disabled={verify.isPending || otp.length !== 6}>
                {verify.isPending && <Spinner className="me-2" />}
                Verify
              </Button>
            </>
          ) : (
            <form onSubmit={onSignup} className="space-y-4" noValidate>
              <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
                <Input id="fullName" {...register('fullName')} />
              </Field>
              <Field label="Username" htmlFor="username" error={errors.username?.message}>
                <Input id="username" autoComplete="username" {...register('username')} />
              </Field>
              <Field label="Email" htmlFor="email" error={errors.email?.message}>
                <Input id="email" type="email" {...register('email')} />
              </Field>
              <Field label="Password" htmlFor="password" error={errors.password?.message}>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...register('password')}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                Password must be at least 8 characters and include an uppercase letter, a lowercase
                letter, and a digit (e.g. Secret123).
              </p>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit" className="w-full" disabled={signup.isPending}>
                {signup.isPending && <Spinner className="me-2" />}
                Create account
              </Button>
            </form>
          )}
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link className="text-primary underline-offset-4 hover:underline" to="/login">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
