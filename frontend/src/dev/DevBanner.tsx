export default function DevBanner() {
  return (
    <div role="note" className="bg-amber-400 px-4 py-1.5 text-center text-sm font-semibold text-amber-950">
      DEVELOPMENT MODE — synthetic data (VITE_USE_MOCKS=true). Not the real backend, not Gemma, not a live transcript.
    </div>
  )
}
