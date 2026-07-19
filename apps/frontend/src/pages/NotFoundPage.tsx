import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/Feedback';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Esta página no existe"
      description="Puede que el enlace esté caducado o que la entrega ya se haya archivado."
      action={
        <Button asChild size="lg" variant="default">
          <Link to="/">Ir a la cola</Link>
        </Button>
      }
    />
  );
}
