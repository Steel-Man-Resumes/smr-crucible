type UnknownRecord = Record<string, unknown>;

export interface NormalizedCareerPath {
  title: string;
  salary_range?: string;
  match_reason?: string;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getCareerPaths(output: unknown): NormalizedCareerPath[] {
  const record = asRecord(output);
  if (!record) return [];

  const raw = Array.isArray(record.career_paths)
    ? record.career_paths
    : Array.isArray(record.careerPaths)
      ? record.careerPaths
      : [];

  return raw
    .map((item) => {
      if (typeof item === "string") return { title: item };
      const cp = asRecord(item);
      if (!cp) return null;
      const title = stringValue(cp.title);
      if (!title) return null;
      return {
        title,
        salary_range: stringValue(cp.salary_range) || stringValue(cp.salaryRange),
        match_reason: stringValue(cp.match_reason) || stringValue(cp.matchReason),
      };
    })
    .filter((item): item is NormalizedCareerPath => item !== null);
}

export function getSkillNames(output: unknown, limit = 15): string[] {
  const record = asRecord(output);
  if (!record) return [];

  const rawSkills = record.skills;
  const skills: string[] = [];

  function pushSkill(value: unknown) {
    if (typeof value === "string" && value.trim()) {
      skills.push(value.trim());
      return;
    }
    const skill = asRecord(value);
    const name = skill ? stringValue(skill.name) : undefined;
    if (name) skills.push(name);
  }

  if (Array.isArray(rawSkills)) {
    rawSkills.forEach(pushSkill);
  } else {
    const grouped = asRecord(rawSkills);
    if (grouped) {
      for (const group of Object.values(grouped)) {
        if (Array.isArray(group)) group.forEach(pushSkill);
      }
    }
  }

  return Array.from(new Set(skills)).slice(0, limit);
}

export function getStrengthTitles(output: unknown, limit = 6): string[] {
  const record = asRecord(output);
  if (!record) return [];

  const narrative = asRecord(record.narrative);
  const raw = Array.isArray(record.strengths)
    ? record.strengths
    : Array.isArray(narrative?.strengths)
      ? narrative?.strengths
      : [];

  const strengths = raw
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const strength = asRecord(item);
      return stringValue(strength?.title) || stringValue(strength?.name) || "";
    })
    .filter(Boolean);

  return Array.from(new Set(strengths)).slice(0, limit);
}
