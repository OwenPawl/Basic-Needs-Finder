import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found">
      <p className="eyebrow">BASIC NEEDS FINDER</p>
      <h1>
        This path is a little
        <br />
        off campus.
      </h1>
      <p>The page you’re looking for isn’t here.</p>
      <Link href="/" className="button primary">
        Back to resources
      </Link>
    </main>
  );
}
