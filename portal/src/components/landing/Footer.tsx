export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
        <span className="font-semibold text-foreground">StewardAI</span>
        <span>&#169; 2026 StewardAI. Your AI meeting agent.</span>
        <a href="/auth/login" className="hover:text-foreground">Sign in</a>
      </div>
    </footer>
  );
}
