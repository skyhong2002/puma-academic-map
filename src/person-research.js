import records from '../data/person-research.json';
import { people } from './person-data.js';

const personKey = ({ section, raw }) => JSON.stringify([section, raw]);
const recordsByPerson = new Map(records.map((record) => [personKey(record), record]));
const peopleByKey = new Map(people.map((person) => [personKey(person), person]));
const peopleById = new Map(records.map((record) => [record.id, peopleByKey.get(personKey(record))]));

function sourceLink(label, url) {
  if (!/^https?:\/\//i.test(url)) return null;
  const anchor = document.createElement('a');
  anchor.textContent = label;
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function heading(text) {
  const title = document.createElement('h3');
  title.textContent = text;
  return title;
}

export function personResearch(person, onOpenPerson) {
  const record = recordsByPerson.get(personKey(person));
  if (!record) return null;

  const keywordsSection = document.createElement('section');
  keywordsSection.className = 'map-person-research';
  keywordsSection.setAttribute('aria-label', '研究資料');
  const keywords = document.createElement('ul');
  keywords.className = 'map-person-research__keywords';
  for (const { label, source } of record.keywords) {
    const link = sourceLink(label, source);
    if (!link) continue;
    link.setAttribute('aria-label', `${label}，開啟來源`);
    const item = document.createElement('li');
    item.append(link);
    keywords.append(item);
  }
  if (keywords.childElementCount) keywordsSection.append(heading('研究關鍵字'), keywords);
  const scholar = record.scholar && sourceLink('Google Scholar', record.scholar);
  if (scholar) {
    scholar.className = 'map-person-research__scholar';
    keywordsSection.append(scholar);
  }

  const related = document.createElement('ul');
  related.className = 'map-person-research__related';
  for (const { id, topics } of record.related ?? []) {
    const other = peopleById.get(id);
    if (!other) continue;
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-person-research__person';
    button.addEventListener('click', () => onOpenPerson(other));
    const name = document.createElement('strong');
    name.textContent = other.name;
    const topic = document.createElement('span');
    topic.textContent = `共同主題：${topics.join('、')}`;
    button.append(name, topic);
    item.append(button);
    related.append(item);
  }
  let relatedSection;
  if (related.childElementCount) {
    relatedSection = document.createElement('section');
    relatedSection.className = 'map-person-research map-person-research--related';
    relatedSection.setAttribute('aria-label', '相關研究者');
    const description = document.createElement('p');
    description.className = 'map-person-research__description';
    description.textContent = `以下推薦的研究者與${person.name}有相近的研究領域，各人下方列出共同主題。`;
    relatedSection.append(heading('相關研究者'), description, related);
  }
  return {
    keywords: keywordsSection.childElementCount ? keywordsSection : null,
    related: relatedSection,
  };
}
