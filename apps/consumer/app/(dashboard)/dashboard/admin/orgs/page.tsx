"use client";

/**
 * Admin org directory -- every partner org with stats, one click into any
 * org's dashboard exactly as they see it (blue, read-only by nature: the
 * partner page itself is a read surface).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRealTier } from "@/lib/useUserTier";

export default function AdminOrgsPage() {
  const realTier = useRealTier();
  const [orgs, setOrgs] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dev/orgs")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setOrgs(d.orgs))
      .catch(() => setError("Could not load organizations."));
  }, []);

  if (realTier !== "admin") {
    return <div className="max-w-4xl mx-auto px-4 py-12 text-t-phos-dim">Admins only.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Organizations</h1>
      <p className="text-t-phos-dim text-sm mb-6">
        Every partner org on the platform. &quot;Open dashboard&quot; shows you exactly what
        that org&apos;s admins see.
      </p>
      {error && <p className="text-sm text-t-red">{error}</p>}
      {!orgs && !error && <p className="text-t-phos-dim text-sm">Loading...</p>}
      {orgs && (
        <div className="overflow-x-auto bg-t-panel border border-t-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
                <th className="px-4 py-3 font-semibold">Organization</th>
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold text-center">Joined</th>
                <th className="px-4 py-3 font-semibold text-center">Staff</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-t-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {o.org_logo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={o.org_logo_url}
                          alt=""
                          className="h-7 w-7 object-contain bg-white border border-t-line p-0.5"
                        />
                      )}
                      <span className="font-medium text-t-white">{o.partner_name}</span>
                      {!o.is_active && (
                        <span className="text-[10px] text-t-red border border-t-red px-1">inactive</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-t-phos">{o.code}</td>
                  <td className="px-4 py-3 text-xs text-t-phos-dim">{o.owner_email || "--"}</td>
                  <td className="px-4 py-3 text-center text-t-white">{o.joined}</td>
                  <td className="px-4 py-3 text-center text-t-white">{o.staff_count}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/partner?codeId=${o.id}`}
                      className="t-focus inline-block px-3 py-1.5 text-xs font-bold border border-[#2d5a85] text-[#2d5a85] hover:bg-[#e9f0f7]"
                    >
                      Open dashboard
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
