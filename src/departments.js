import { unitInstitutionAliases } from './campus-locations.js';

const institutionFiles = import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' });
const aliasesByInstitution = new Map(Object.values(institutionFiles).flat()
  .map(({ name, aliases }) => [name, aliases]));

const normalizeUnit = (text) => text.replace(/\s+/g, '').replaceAll('台', '臺');

export function departmentFor(person, institution) {
  const documented = person.refs.find((ref) => ref.department && ref.institutions?.includes(institution));
  if (documented) return documented.department;
  const aliases = [institution, institution.replace(/^國立/, ''), ...aliasesByInstitution.get(institution) ?? [],
    ...unitInstitutionAliases[institution] ?? []]
    .map(normalizeUnit).sort((a, b) => b.length - a.length);
  for (const ref of person.refs) {
    if (!ref.label.startsWith('教育部 ') || !ref.label.endsWith('師資名錄')) continue;
    const listing = ref.description.split('記載：')[1];
    for (const claim of listing?.split('；') ?? []) {
      const heading = normalizeUnit(claim.split('，')[0].split('財團法人').at(-1));
      const alias = aliases.find((item) => heading.startsWith(item));
      if (alias && heading.length > alias.length) return heading.slice(alias.length);
    }
  }
  for (const claim of person.affiliation_text.split(/[、，；／/]/)) {
    const heading = normalizeUnit(claim).replace(/^(前|曾任)/, '');
    const alias = aliases.find((item) => heading.startsWith(item));
    if (!alias) continue;
    const department = heading.slice(alias.length).match(/^([\p{Script=Han}]{1,24}?(?:學系|研究所|學位學程|學程|學院|中心|學士班|院|系|所|部))(?=兼任|專任|約聘|名譽|榮譽|退休|教授|副教授|助理|博士|碩士|講師|研究員|主任|創意長|特聘|講座|$)/u);
    if (department) return department[1];
  }
  return '系所未標明';
}
