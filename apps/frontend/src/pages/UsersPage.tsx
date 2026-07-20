import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { CreateUserRequest, USER_ROLE_LABEL, UserRole } from '@vega/shared';
import type {
  CreateUserRequest as CreateUserBody,
  MoodleConnectionResponse,
  UpdateUserRequest,
  User,
} from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { notify } from '@/lib/notify';
import { BRAND_NAME } from '@/lib/brand';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/Feedback';
import { Field } from '@/components/common/Field';
import { KEEP, SecretField, secretPatch } from '@/components/settings/SecretField';
import type { SecretState } from '@/components/settings/SecretField';

export function UsersPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const query = useQuery({
    queryKey: queryKeys.users,
    queryFn: ({ signal }) => api.users(signal),
  });
  const users = query.data?.items ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.users });

  const createMutation = useMutation({
    mutationFn: (body: CreateUserBody) => api.createUser(body),
    onSuccess: () => {
      void invalidate();
      setCreating(false);
      notify.success('Usuario creado');
    },
    onError: (error) => notify.error('No se ha podido crear el usuario', error),
  });

  const updateMutation = useMutation({
    mutationFn: (variables: { id: string; body: UpdateUserRequest }) =>
      api.updateUser(variables.id, variables.body),
    onSuccess: () => {
      void invalidate();
      setEditing(null);
      notify.success('Usuario actualizado');
    },
    onError: (error) => notify.error('No se ha podido actualizar el usuario', error),
  });

  return (
    <div>
      <PageHeader
        eyebrow="Administración"
        title="Usuarios"
        actions={
          <Button variant="default" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Nuevo
          </Button>
        }
      >
        Quién puede entrar en {BRAND_NAME} y con qué permisos.
      </PageHeader>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2].map((key) => (
            <Card key={key} asChild>
              <li className="p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2.5 h-3 w-56" />
              </li>
            </Card>
          ))}
        </ul>
      ) : users.length === 0 ? (
        <EmptyState title="No hay usuarios" description="Crea el primero para empezar." />
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => setEditing(user)}
                className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-border-strong"
              >
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-medium">{user.name}</p>
                  <Badge variant={user.role === 'admin' ? 'primary' : 'default'}>
                    {USER_ROLE_LABEL[user.role]}
                  </Badge>
                  {!user.active ? <Badge>Desactivado</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-ui text-muted-foreground">{user.email}</p>
                <p className="mt-1 text-ui text-muted-foreground">
                  {user.lastLoginAt
                    ? `Último acceso: ${formatDateTime(user.lastLoginAt)}`
                    : 'Todavía no ha entrado'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreateUserSheet
        open={creating}
        onClose={() => setCreating(false)}
        loading={createMutation.isPending}
        onSubmit={(body) => createMutation.mutate(body)}
      />

      <EditUserSheet
        user={editing}
        onClose={() => setEditing(null)}
        loading={updateMutation.isPending}
        onSubmit={(body) => {
          if (editing) updateMutation.mutate({ id: editing.id, body });
        }}
      />
    </div>
  );
}

function RoleField({ value, onChange }: { value: UserRole; onChange: (role: UserRole) => void }) {
  return (
    <Field label="Rol" hint="El administrador además gestiona usuarios y ajustes.">
      {({ id, ...aria }) => (
        <Select
          value={value}
          onValueChange={(next) => {
            const parsed = UserRole.safeParse(next);
            if (parsed.success) onChange(parsed.data);
          }}
        >
          <SelectTrigger id={id} {...aria}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UserRole.options.map((role) => (
              <SelectItem key={role} value={role}>
                {USER_ROLE_LABEL[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

function ActiveField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-base">
          Cuenta activa
        </Label>
        <p id={`${id}-hint`} className="mt-0.5 text-ui text-muted-foreground">
          Una cuenta desactivada no puede iniciar sesión.
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}

function CreateUserSheet({
  open,
  onClose,
  loading,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onSubmit: (body: CreateUserBody) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('teacher');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const parsed = CreateUserRequest.safeParse({ email, name, password, role });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setErrors({
        email: fields.email?.[0] ?? '',
        name: fields.name?.[0] ?? '',
        password: fields.password?.[0] ?? '',
      });
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nuevo usuario</SheetTitle>
          <SheetDescription>
            Se crea con acceso inmediato. La contraseña la cambia después la persona.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-4">
          <Field label="Nombre" error={errors.name || undefined}>
            {(field) => (
              <Input {...field} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Correo electrónico" error={errors.email || undefined}>
            {(field) => (
              <Input
                {...field}
                type="email"
                autoCapitalize="none"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Contraseña"
            error={errors.password || undefined}
            hint="Mínimo 8 caracteres."
          >
            {(field) => (
              <Input
                {...field}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <RoleField value={role} onChange={setRole} />
        </SheetBody>

        <SheetFooter>
          <Button variant="ghost" size="lg" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="default" size="lg" onClick={submit} loading={loading}>
            Crear usuario
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Token de Moodle de otra persona.
 *
 * En Moodle, un administrador puede emitir un token a nombre de cualquiera, y
 * es así como esto se despliega de verdad: esperar a que cada profesor
 * encuentre sus claves de seguridad en Moodle es donde se atasca la
 * instalación. El valor **no se lee nunca**, tampoco aquí: sólo se sustituye,
 * se borra o se prueba.
 *
 * Va aparte del resto del formulario porque no es un campo más: se guarda por
 * su cuenta y con su propia confirmación.
 */
function UserMoodleToken({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<SecretState>(KEEP);
  const [result, setResult] = useState<MoodleConnectionResponse | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const patch = secretPatch(token);
      if (patch === undefined) throw new Error('No hay ningún cambio que guardar.');
      return api.updateUserMoodleToken(user.id, { token: patch });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
      setToken(KEEP);
      setResult(null);
      notify.success('Token guardado');
    },
    onError: (error) => notify.error('No se ha podido guardar el token', error),
  });

  const test = useMutation({
    mutationFn: () => api.testUserMoodleConnection(user.id),
    onSuccess: setResult,
    onError: (error) => notify.error('No se ha podido probar la conexión', error),
  });

  const pending = secretPatch(token) !== undefined;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <SecretField
        label="Token de Moodle"
        configured={user.moodleTokenConfigured}
        state={token}
        onChange={setToken}
        hint="Genéralo en Moodle desde Administración del sitio → Servidor → Servicios web → Administrar credenciales, a nombre de esta persona."
      />

      <p className="text-ui text-muted-foreground">
        Decide qué cursos ve. Sin token, esta persona no puede dar de alta actividades.
      </p>

      {result ? (
        <p
          className={cn('text-ui', result.ok ? 'text-success-ink' : 'text-destructive-ink')}
          aria-live="polite"
        >
          {result.ok
            ? `${result.message} ${result.siteName} · ${result.username} · ${
                result.courseCount === 1 ? '1 curso' : `${result.courseCount ?? 0} cursos`
              }`
            : result.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!pending} loading={save.isPending} onClick={() => save.mutate()}>
          Guardar token
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!user.moodleTokenConfigured || pending}
          loading={test.isPending}
          onClick={() => test.mutate()}
        >
          Probar conexión
        </Button>
      </div>
    </div>
  );
}

function EditUserSheet({
  user,
  onClose,
  loading,
  onSubmit,
}: {
  user: User | null;
  onClose: () => void;
  loading: boolean;
  onSubmit: (body: UpdateUserRequest) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('teacher');
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Sembramos el formulario al abrir la hoja con otro usuario.
  if (user && loadedFor !== user.id) {
    setLoadedFor(user.id);
    setName(user.name);
    setRole(user.role);
    setActive(user.active);
    setPassword('');
  }

  return (
    <Sheet open={user !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{user?.name ?? 'Usuario'}</SheetTitle>
          <SheetDescription>{user?.email}</SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-4">
          <Field label="Nombre">
            {(field) => (
              <Input {...field} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <RoleField value={role} onChange={setRole} />
          <ActiveField checked={active} onChange={setActive} />
          <Field
            label="Nueva contraseña"
            hint="Déjalo vacío para no cambiarla. Mínimo 8 caracteres."
          >
            {(field) => (
              <Input
                {...field}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>

          {user ? <UserMoodleToken user={user} /> : null}
        </SheetBody>

        <SheetFooter>
          <Button variant="ghost" size="lg" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="default"
            size="lg"
            loading={loading}
            onClick={() =>
              onSubmit({
                name,
                role,
                active,
                ...(password.length >= 8 ? { password } : {}),
              })
            }
          >
            Guardar cambios
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
