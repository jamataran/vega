import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AiCall, AiOperation } from '@vega/shared';
import { AI_OPERATION_LABEL } from '@vega/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { formatDateTime } from '@/lib/format';
import { notify } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ErrorState, EmptyState, PageHeader } from '@/components/common/Feedback';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const OPERATIONS = ['reading_a', 'reading_b', 'grade', 'triage', 'verify', 'forum_answer', 'connection_test'] as const;

export function AiCallsPage() {
  const [operation, setOperation] = useState<AiOperation | 'all'>('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AiCall | null>(null);
  const params = { ...(operation === 'all' ? {} : { operation }), ...(errorsOnly ? { errorsOnly: true } : {}), page, pageSize: 50 };
  const query = useQuery({ queryKey: queryKeys.aiCalls(params), queryFn: ({ signal }) => api.aiCalls(params, signal) });

  const copy = async (call: AiCall) => {
    await navigator.clipboard.writeText(JSON.stringify(call, null, 2));
    notify.success('JSON copiado');
  };

  return (
    <div className="pb-4">
      <PageHeader eyebrow="Administración" title="Registro de IA">Cada intento queda trazado con modelo, prompt, contexto, tokens y respuesta.</PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={operation} onValueChange={(value) => { setOperation(value as AiOperation | 'all'); setPage(1); setSelected(null); }}>
          <SelectTrigger className="w-56" aria-label="Filtrar por operación"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las operaciones</SelectItem>{OPERATIONS.map((item) => <SelectItem key={item} value={item}>{AI_OPERATION_LABEL[item]}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant={errorsOnly ? 'default' : 'outline'} aria-pressed={errorsOnly} onClick={() => { setErrorsOnly((value) => !value); setPage(1); setSelected(null); }}>Sólo errores</Button>
      </div>
      {query.isPending ? <p role="status" className="mb-3 text-ui text-muted-foreground">Cargando llamadas…</p> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.isPending && query.data?.items.length === 0 ? <EmptyState title="Sin llamadas" description="No hay intentos que coincidan con estos filtros." /> : null}
      <div className="flex flex-col gap-2">
        {query.data?.items.map((call) => (
          <Card key={call.id} asChild><button type="button" className="w-full p-3 text-left" aria-expanded={selected?.id === call.id} aria-controls="ai-call-detail" onClick={() => setSelected(call)}>
            <div className="flex flex-wrap items-center gap-2"><Badge variant={call.error ? 'destructive' : 'outline'}>{AI_OPERATION_LABEL[call.operation]}</Badge><span className="font-mono text-ui">{call.modelReturned ?? call.modelRequested}</span><span className="ml-auto text-ui text-muted-foreground">{formatDateTime(call.createdAt)}</span></div>
            <p className="mt-1 truncate text-ui text-muted-foreground">{call.error ?? `${call.inputTokens} entrada · ${call.outputTokens} salida${call.simulated ? ' · simulado' : ''}`}</p>
          </button></Card>
        ))}
      </div>
      {query.data && query.data.meta.totalPages > 1 ? (
        <nav aria-label="Páginas del registro de IA" className="mt-4 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => { setPage((value) => Math.max(1, value - 1)); setSelected(null); }}>Anterior</Button>
          <span className="text-ui text-muted-foreground" aria-live="polite">Página {page} de {query.data.meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= query.data.meta.totalPages || query.isFetching} onClick={() => { setPage((value) => value + 1); setSelected(null); }}>Siguiente</Button>
        </nav>
      ) : null}
      {selected ? <Card id="ai-call-detail" className="mt-4 p-4"><div className="mb-2 flex items-center justify-between"><h2 className="font-display font-semibold">Detalle reproducible</h2><Button size="sm" onClick={() => void copy(selected)}>Copiar JSON</Button></div><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-micro">{JSON.stringify(selected, null, 2)}</pre></Card> : null}
    </div>
  );
}
