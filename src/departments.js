import { unitInstitutionAliases } from './campus-locations.js';
import unitAliases from '../data/unit-aliases.json';

const institutionFiles = import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' });
const aliasesByInstitution = new Map(Object.values(institutionFiles).flat()
  .map(({ name, aliases }) => [name, aliases]));

const normalizeUnit = (text) => text.replace(/\s+/g, '').replaceAll('台', '臺');

// 單位資料中的 aliases（例如「生科系」）一律歸到正式單位名稱（「生命科學系」），避免同一系被拆成兩組。
const unitFiles = import.meta.glob('../data/units/*.json', { eager: true, import: 'default' });
const unitKey = (text) => normalizeUnit(text.normalize('NFKC')).replaceAll('學系', '系');
const canonicalUnits = new Map();
for (const { institution, units } of Object.values(unitFiles)) {
  if (!institution || !units) continue;
  const names = canonicalUnits.get(institution) ?? new Map();
  canonicalUnits.set(institution, names);
  for (const [unit, record] of Object.entries(units)) {
    if (!names.has(unitKey(unit))) names.set(unitKey(unit), unit);
    for (const alias of record.aliases ?? []) if (!names.has(unitKey(alias))) names.set(unitKey(alias), unit);
  }
}

// data/unit-aliases.json：資料裡沒有座標、但同一系所有不同寫法的對照（簡稱、改名前後）。
for (const [institution, variants] of Object.entries(unitAliases)) {
  const names = canonicalUnits.get(institution) ?? new Map();
  canonicalUnits.set(institution, names);
  for (const [variant, canonical] of Object.entries(variants)) names.set(unitKey(variant), canonical);
}

export function departmentFor(person, institution) {
  const label = rawDepartmentFor(person, institution);
  return canonicalUnits.get(institution)?.get(unitKey(label)) ?? label;
}

function rawDepartmentFor(person, institution) {
  // ref.departments 逐機構指定系所；沒有時才用 ref.department（套用到 ref.institutions 的每個機構）。
  const documented = person.refs.find((ref) => ref.departments?.[institution]
    || (ref.department && ref.institutions?.includes(institution)));
  if (documented) return documented.departments?.[institution] || documented.department;
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
