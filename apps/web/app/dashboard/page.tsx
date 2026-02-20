"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

interface Project {
  id: string;
  title: string;
  status: string;
  display_label: string;
  created_at: string;
  updated_at: string;
  doc_count: string;
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOrg, setHasOrg] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [orgName, setOrgName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects() {
    const res = await fetch("/api/projects");
    if (res.status === 403) {
      setHasOrg(false);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setProjects(data);
    }
    setLoading(false);
  }

  async function createOrg() {
    if (!orgName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: orgName }),
    });
    if (res.ok) {
      setHasOrg(true);
      setShowCreateOrg(false);
      setOrgName("");
      fetchProjects();
    }
    setCreating(false);
  }

  async function createProject() {
    if (!newTitle.trim()) return;
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
    if (res.ok) {
      setShowNewProject(false);
      setNewTitle("");
      fetchProjects();
    }
    setCreating(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasOrg) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-20"
      >
        <h2 className="text-2xl font-semibold mb-2">Welcome to Crucible</h2>
        <p className="text-[var(--muted)] mb-6">
          Create an organization to get started.
        </p>
        {showCreateOrg ? (
          <div className="inline-flex gap-2">
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createOrg()}
              placeholder="Organization name"
              autoFocus
              className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button
              onClick={createOrg}
              disabled={creating}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCreateOrg(true)}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Create Organization
          </button>
        )}
      </motion.div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Projects</h1>
        {showNewProject ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              placeholder="Project title"
              autoFocus
              className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button
              onClick={createProject}
              disabled={creating}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowNewProject(false)}
              className="px-3 py-2 text-[var(--muted)] hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewProject(true)}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            New Project
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 border border-dashed border-[var(--border)] rounded-xl"
        >
          <p className="text-[var(--muted)] mb-2">No projects yet</p>
          <p className="text-sm text-[var(--muted)]">
            Create your first project to get started.
          </p>
        </motion.div>
      ) : (
        <AnimatePresence>
          <div className="grid gap-3">
            {projects.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  href={`/dashboard/${project.id}`}
                  className="block p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl hover:border-[var(--accent)]/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{project.title}</h3>
                      <p className="text-sm text-[var(--muted)] mt-1">
                        {project.display_label}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          project.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-zinc-500/10 text-zinc-400"
                        }`}
                      >
                        {project.status}
                      </span>
                      <p className="text-xs text-[var(--muted)] mt-1">
                        {parseInt(project.doc_count)} doc
                        {parseInt(project.doc_count) !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
