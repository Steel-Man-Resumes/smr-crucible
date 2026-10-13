/** Keep an auditor from dropping a skill that the person's own affirmative line names. */
export function sourceExplicitlySupportsSkill(source: string, skill: string): boolean {
  const normalize = (word: string) => {
    let value = word.toLowerCase();
    if (value.endsWith("ies") && value.length > 4) value = `${value.slice(0, -3)}y`;
    else if (value.endsWith("ing") && value.length > 5) value = value.slice(0, -3);
    else if (value.endsWith("ed") && value.length > 4) value = value.slice(0, -2);
    else if (value.endsWith("s") && value.length > 3) value = value.slice(0, -1);
    return value;
  };
  const tokens = (value: string) => (value.toLowerCase().match(/[a-z]+/g) || []).map(normalize);
  const needed = tokens(skill);
  if (!needed.length || needed.length > 5) return false;

  // A matching phrase inside a denial or a future goal is not proof of a skill.
  const uncertain = /\b(no|not|never|without|cannot|can't|didn't|haven't|hasn't|lack|lacks|seeking|seek|want|wants|hope|hopes|plan|plans|need|needs|interested|in progress)\b/i;
  return source.split(/[\n.!?;]+/).some((line) => {
    if (uncertain.test(line)) return false;
    const present = tokens(line);
    const adjacent = (ordered: string[]) => present.some((token, index) =>
      token === ordered[0] && ordered.every((part, offset) => present[index + offset] === part));
    return adjacent(needed) || (needed.length === 2 && adjacent([...needed].reverse()));
  });
}
