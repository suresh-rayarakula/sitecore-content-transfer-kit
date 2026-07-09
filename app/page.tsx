import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center px-6">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Transfer Yard</p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Content Transfer Console</h1>
      <p className="mt-3 text-sm text-white/50">
        This app is meant to run inside SitecoreAI / XM Cloud as a registered Marketplace Custom
        App (extension point: <span className="text-white/80">Standalone</span>). You can also open
        the console directly for local testing:
      </p>
      <Link
        href="/standalone-extension"
        className="mt-6 rounded-md bg-accent px-5 py-2.5 font-mono text-sm font-medium uppercase tracking-wide text-ink hover:opacity-90"
      >
        Open the console →
      </Link>
    </main>
  );
}
