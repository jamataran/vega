import { EmptyState } from '@/components/common/Feedback';
import { MathText } from '@/components/Latex';

/**
 * Lo que ha escrito el alumno cuando la actividad no trae fichero: los mensajes
 * del foro, ya concatenados por el conector. No pasa por transcripción, así que
 * esto *es* la entrega, no una interpretación de ella.
 */
export function StudentTextView({
  textContent,
  studentLabel,
}: {
  textContent: string | null;
  studentLabel: string;
}) {
  if (textContent === null || textContent.trim() === '') {
    return (
      <EmptyState
        title="Sin contenido"
        description="Esta entrega no trae texto del alumno. Revisa el conector de Moodle."
      />
    );
  }

  return (
    <div className="scroll-pane h-full px-4 py-4">
      <div className="mx-auto max-w-3xl">
        <h2 className="eyebrow mb-2">Entrega de {studentLabel}</h2>
        <div className="whitespace-pre-wrap rounded-lg border border-border bg-card px-4 py-3 text-base leading-relaxed">
          <MathText>{textContent}</MathText>
        </div>
      </div>
    </div>
  );
}
