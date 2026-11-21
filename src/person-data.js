import roster from '../data/signatories.json';
import sources from '../data/affiliation-sources.json';
import institutions from '../data/institution-points.json';
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
  return [...new Map(refs.filter((ref) => /^https?:\/\//i.test(ref.url))
    .map((ref) => [ref.url, ref])).values()];
}

export function portraitFor(section, raw) {
  const record = Object.values(portraitIndices).map((index) => index[section]?.[raw]).find(Boolean);
  const image = record && portraitFiles[`../data/portraits/${record.file}`];
  return image ? { ...record, image } : null;
}

export const isTaiwan = (point) => ['臺灣', '台灣', 'Taiwan', 'TW'].includes(point.country);

export const people = Object.entries(roster.sections).flatMap(([section, group]) => {
  const uniqueEntries = [...new Map(group.entries.map((entry) => [entry.raw, entry])).values()];
  return uniqueEntries.map((entry) => {
    const refs = affiliationSources(section, entry.raw);
    const officialLocations = refs.flatMap((ref) => (ref.institutions ?? []).flatMap((institution) => {
      const place = institutions[institution];
      return place ? [{ institution, ...place }] : [];
    }));
    const researched = (bySection.get(section)?.get(entry.raw) ?? []).flatMap((record) => record.locations ?? []);
    const locations = [...new Map([...officialLocations, ...researched]
      .filter((point) => point.country && point.institution && Number.isFinite(point.lat) && Number.isFinite(point.lon)
        && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180)
      .map((point) => [`${point.country}|${point.institution}`, point])).values()];
    return { ...entry, section, refs, locations, portrait: portraitFor(section, entry.raw) };
  });
});
