import { departmentFor } from './departments.js';
import { canonicalCampus, unitInstitutionAliases, officialCampus, officialCampusAt } from './campus-locations.js';

const files = import.meta.glob('../data/units/*.json', { eager: true, import: 'default' });
const normalize = (text) => text.normalize('NFKC').replace(/\s+/g, '').replaceAll('台', '臺').replaceAll('學系', '系');
const byInstitution = new Map();
const catalog = Object.values(import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' })).flat();
const aliases = new Map(catalog.map(({ name, aliases }) => [name, aliases ?? []]));
export const unitLocations = [];

for (const { institution, campus, units } of Object.values(files)) {
  if (!institution || !units) continue;
  if (!byInstitution.has(institution)) byInstitution.set(institution, new Map());
  const names = byInstitution.get(institution);
  for (const [unit, record] of Object.entries(units)) {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) continue;
    const point = { campus, ...record, unit, institution, country: '臺灣' };
    const anchor = point.campus && officialCampus(institution, point.campus);
    if (anchor) point.city = anchor.city;
    const key = normalize(unit);
    if (names.has(key)) continue;
    names.set(key, point);
    for (const alias of record.aliases ?? []) if (!names.has(normalize(alias))) names.set(normalize(alias), point);
    unitLocations.push(point);
  }
}

export function locatedUnit(person, point) {
  const campus = canonicalCampus(point);
  const campusOnly = person.locations?.some((location) => location.campus_only &&
    location.institution === campus.institution && location.lat === campus.lat && location.lon === campus.lon);
  if (campusOnly) return null;
  const locations = byInstitution.get(campus.institution);
  if (!locations) return null;
  const label = departmentFor(person, campus.institution);
  const unit = locations.get(normalize(label));
  if (!unit || (unit.campus && unit.campus !== campus.campus)) return null;
  return unit;
}

export function refineCampus(person, point) {
  const campus = canonicalCampus(point);
  if (campus.campus_only) return campus;
  const locations = byInstitution.get(campus.institution);
  if (!locations) return campus;
  const genericGuangfu = point.institution === '國立陽明交通大學' &&
    campus.campus === '新竹光復校區' && !/光復校區/.test(person.affiliation_text);
  if (campus.campus && !genericGuangfu) return campus;
  const unitName = departmentFor(person, campus.institution);
  const unit = locations.get(normalize(unitName));
  return (unit?.campus && officialCampus(unit.institution, unit.campus)) ||
    officialCampusAt(campus) || campus;
}

export function findUnits(query) {
  const key = normalize(query).toLowerCase();
  if (!key) return [];
  const tokens = query.trim().split(/\s+/).map((word) => normalize(word).toLowerCase());
  return unitLocations.filter((point) => {
    const institutions = [point.institution, ...(aliases.get(point.institution) ?? []),
      ...(unitInstitutionAliases[point.institution] ?? [])];
    const labels = [point.unit, point.building, ...(point.aliases ?? [])];
    const haystack = [...labels, ...institutions.flatMap((name) => labels.map((label) => name + label))]
      .map((text) => normalize(text).toLowerCase());
    return tokens.every((token) => haystack.some((text) => text.includes(token)));
  }).slice(0, 12);
}
