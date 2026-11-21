import { departmentFor } from './person-map.js';

const files = import.meta.glob('../data/units/*.json', { eager: true, import: 'default' });
const normalize = (text) => text.normalize('NFKC').replace(/\s+/g, '').replaceAll('台', '臺').replaceAll('學系', '系');
const byInstitution = new Map();
const catalog = Object.values(import.meta.glob('../data/institutions/*.json', { eager: true, import: 'default' })).flat();
const aliases = new Map(catalog.map(({ name, aliases }) => [name, aliases ?? []]));
export const unitLocations = [];

for (const { institution, units } of Object.values(files)) {
  if (!institution || !units) continue;
  if (!byInstitution.has(institution)) byInstitution.set(institution, new Map());
  const names = byInstitution.get(institution);
  for (const [unit, record] of Object.entries(units)) {
    if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) continue;
    const point = { ...record, unit, institution, country: '臺灣' };
    const key = normalize(unit);
    if (names.has(key)) continue;
    names.set(key, point);
    for (const alias of record.aliases ?? []) if (!names.has(normalize(alias))) names.set(normalize(alias), point);
    unitLocations.push(point);
  }
}

export function locatedUnit(person, point) {
  const locations = byInstitution.get(point.institution);
  if (!locations) return null;
  const label = departmentFor(person, point.institution);
  return locations.get(normalize(label)) ?? null;
}

export function findUnits(query) {
  const key = normalize(query).toLowerCase();
  if (!key) return [];
  const tokens = query.trim().split(/\s+/).map((word) => normalize(word).toLowerCase());
  return unitLocations.filter((point) => {
    const institutions = [point.institution, ...(aliases.get(point.institution) ?? [])];
    const labels = [point.unit, point.building, ...(point.aliases ?? [])];
    const haystack = [...labels, ...institutions.flatMap((name) => labels.map((label) => name + label))]
      .map((text) => normalize(text).toLowerCase());
    return tokens.every((token) => haystack.some((text) => text.includes(token)));
  }).slice(0, 12);
}
