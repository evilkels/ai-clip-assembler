import { useReview } from '../state/ReviewContext';

export function FinishAiScoring({ clipsLeft }: { clipsLeft: number }) {
  const { resumingAiScoring, resumeError, resumeAiScoring } = useReview();

  return (
    <>
      {clipsLeft > 0 ? (
        <button
          type="button"
          className="btn subtle"
          disabled={resumingAiScoring}
          onClick={() => void resumeAiScoring()}
        >
          {resumingAiScoring ? 'Scoring…' : `Finish AI scoring (${clipsLeft} clips left)`}
        </button>
      ) : null}
      {resumeError ? <p className="import-status-error">{resumeError}</p> : null}
    </>
  );
}
