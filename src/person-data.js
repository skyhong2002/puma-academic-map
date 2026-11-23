import roster from '../data/signatories.json';
import sources from '../data/affiliation-sources.json';
import institutions from '../data/institution-points.json';
import { refineCampus } from './unit-locations.js';
const portraitIndices = import.meta.glob('../data/portraits/*.json', { eager: true, import: 'default' });

const portraitFiles = import.meta.glob('../data/portraits/*.webp', { eager: true, import: 'default', query: '?url' });

const research = import.meta.glob('../data/research/*.json', { eager: true, import: 'default' });
const bySection = new Map();
for (const record of Object.values(research).flat()) {
  if (!bySection.has(record.section)) bySection.set(record.section, new Map());
  const section = bySection.get(record.section);
  const matches = section.get(record.raw) ?? [];
  matches.push(record);
  section.set(record.raw, matches);
}

export function affiliationSources(section, raw) {
  const refs = [
    ...(sources[section]?.[raw] ?? []),
    ...(bySection.get(section)?.get(raw) ?? []).flatMap((record) => record.sources ?? []),
  ];
  const byUrl = new Map();
  for (const ref of refs) {
    if (!/^https?:\/\//i.test(ref.url)) continue;
    const previous = byUrl.get(ref.url);
    const units = new Set([...(previous?.institutions ?? []), ...(ref.institutions ?? [])]);
    const departments = { ...previous?.departments, ...ref.departments };
    byUrl.set(ref.url, { ...previous, ...ref, institutions: [...units],
      ...(Object.keys(departments).length ? { departments } : {}) });
  }
  return [...byUrl.values()];
}

export function portraitFor(section, raw) {
  const record = Object.values(portraitIndices).map((index) => index[section]?.[raw]).find(Boolean);
  const image = record && (portraitFiles[`../data/portraits/${record.file}`]
    ?? (/^https:\/\//i.test(record.image_url ?? '') ? record.image_url : null));
  return image ? { ...record, image } : null;
}

export const isTaiwan = (point) => ['臺灣', '台灣', 'Taiwan', 'TW'].includes(point.country);

export const people = Object.entries(roster.sections).flatMap(([section, group]) => {
  const uniqueEntries = [...new Map(group.entries.map((entry) => [entry.raw, entry])).values()];
  return uniqueEntries.map((entry) => {
    const refs = affiliationSources(section, entry.raw);
    const person = { ...entry, section, refs, portrait: portraitFor(section, entry.raw) };
    const officialLocations = refs.flatMap((ref) => (ref.institutions ?? []).flatMap((institution) => {
      const place = institutions[institution];
      return place ? [{ institution, ...place }] : [];
    }));
    const researched = (bySection.get(section)?.get(entry.raw) ?? []).flatMap((record) => record.locations ?? []);
    // 人物層級校區記錄可用 replaces_default 明確取代同校的教育部預設點（避免同校出現兩個點）。
    const replaced = new Set(researched.filter((point) => point.replaces_default && point.campus).map((point) => point.institution));
    const generic = officialLocations.filter((point) => !replaced.has(point.institution));
    const locations = [...new Map([...generic, ...researched]
      .filter((point) => point.country && point.institution && Number.isFinite(point.lat) && Number.isFinite(point.lon)
        && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180)
      .map((point) => refineCampus(person, point))
      .map((point) => [JSON.stringify([point.country, point.institution, point.campus]), point])).values()];
    return { ...person, locations };
  });
});
