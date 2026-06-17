// Pure helpers shared by the log screen editor hooks.

export function buildDayGroups(sections) {
  const groups = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last && last.heading === section.heading) {
      last.sections.push(section);
    } else {
      groups.push({ heading: section.heading, sections: [section] });
    }
  }
  return groups;
}
