import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center px-6">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Sitecore Content Transfer Kit</p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">Content Transfer Console</h1>
      <p className="mt-3 text-sm text-white/50">
        This app is designed to run inside SitecoreAI / XM Cloud as a registered Marketplace Custom
        App (Standalone extension point). You can also open the console directly for local testing,
        or use the hosted public app:
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link
          href="/standalone-extension"
          className="rounded-md bg-accent px-5 py-2.5 font-mono text-sm font-medium uppercase tracking-wide text-ink hover:opacity-90"
        >
          Open the console →
        </Link>
        <a
          href="https://sitecore-content-transfer-kit.vercel.app/"
          target="_blank"
          rel="noreferrer"
          className="font-mono text-sm text-white/70 underline-offset-4 hover:text-white"
        >
          https://sitecore-content-transfer-kit.vercel.app/
        </a>
      </div>
    </main>
  );
}
