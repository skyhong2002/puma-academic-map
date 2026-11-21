import institutionAliases from '../data/emblems/aliases.json';

const indices = Object.values(import.meta.glob([
  '../data/emblems/*.json',
  '!../data/emblems/aliases.json',
], { eager: true, import: 'default' }));
const files = import.meta.glob('../data/emblems/*.{webp,png,svg}', { eager: true, import: 'default', query: '?url' });
const records = new Map(indices.flatMap((index) => Object.entries(index)));
const aliases = new Map(Object.entries(institutionAliases));

export function emblemFor(institution) {
  const record = records.get(institution) ?? records.get(aliases.get(institution));
  const image = record && files[`../data/emblems/${record.file}`];
  return image ? { ...record, image } : null;
}

export function emblemImage(emblem) {
  const image = document.createElement('img');
  image.className = 'atlas-emblem atlas-emblem--official';
  image.src = emblem.image;
  image.alt = '';
  image.decoding = 'async';
  return image;
}
