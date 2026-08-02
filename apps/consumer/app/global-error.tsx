"use client";

/**
 * Last-resort boundary for errors thrown in the root layout itself.
 * Must render its own html/body; styled inline because the app shell
 * (and its CSS) may not have loaded.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#eaede9",
          color: "#1c1e1b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
            Something went wrong.
          </h1>
          <p style={{ fontSize: "0.9rem", color: "#5f665f", marginBottom: "1.5rem" }}>
            Your work is saved on this device. Reload to continue.
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 1.5rem",
              borderRadius: "6px",
              border: "none",
              background: "#9b6d1d",
              color: "#ffffff",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
