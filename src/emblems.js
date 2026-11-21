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

const shortNames = {
  國立臺灣大學: '臺大',
  國立政治大學: '政大',
  國立臺灣師範大學: '師大',
  國立陽明交通大學: '陽明交大',
  國立清華大學: '清大',
  國立成功大學: '成大',
  輔仁大學: '輔大',
  國立臺北大學: '臺北大',
  國立中正大學: '中正',
  國立中興大學: '興大',
  國立中山大學: '中山',
  淡江大學: '淡江',
  國立臺東大學: '臺東大',
  慈濟大學: '慈濟',
  國立金門大學: '金大',
  國立臺北教育大學: '北教大',
  國立臺灣科技大學: '臺科大',
  國立臺北科技大學: '北科大',
  臺北市立大學: '北市大',
  臺北醫學大學: '北醫',
  國立屏東大學: '屏大',
  國立屏東科技大學: '屏科大',
  國立澎湖科技大學: '澎科大',
  中央研究院: '中研院',
  中央研究院民族學研究所: '民族所',
  中央研究院分子生物研究所: '分生所',
  中央研究院資訊科學研究所: '資訊所',
  中央研究院生醫轉譯研究中心: '生醫轉譯',
  國家衛生研究院: '國衛院',
  國家同步輻射研究中心: '同步輻射',
  臺灣經濟研究院: '台經院',
  台灣金融研訓院: '金融研訓',
  農業部林業試驗所: '林試所',
  財團法人食品工業發展研究所: '食品所',
};

function shortName(institution) {
  const name = (aliases.get(institution) ?? institution)
    .replace(/（[^）]+）$/, '')
    .replace(/^台灣/, '臺灣');
  const label = shortNames[name] ?? shortNames[institution];
  if (label) return label;
  if (/^\p{Script=Han}/u.test(name)) {
    return [...name.replace(/^(?:國立|財團法人|中央研究院)/u, '')].slice(0, 3).join('');
  }
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = words.length > 1 ? words.map((word) => [...word][0]).join('') : words[0] ?? '';
  return [...initials].slice(0, 4).join('').toUpperCase();
}

export function institutionMark(institution) {
  const emblem = emblemFor(institution);
  if (emblem) return emblemImage(emblem);

  const label = document.createElement('span');
  label.className = 'atlas-emblem atlas-emblem--text';
  label.setAttribute('aria-hidden', 'true');
  label.textContent = shortName(institution);
  return label;
}
