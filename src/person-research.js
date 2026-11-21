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

function academicTitle(affiliation) {
  return affiliation.match(/(?:(?:兼任|專任|名譽|榮譽|榮退|退休|特聘|講座|客座|專技|臨床|專案|約聘|訪問|通訊|合聘|資深)\s*)*(?:(?:副|助理)?教授(?:級(?:專業技術人員|專家|研究員|主治醫師))?|博士後(?:研究員|研究人員)?|(?:助理|助|副)?研究員|講師|院士)/u)?.[0]
    ?? affiliation.match(/\b(?:(?:Visiting|Adjunct|Emeritus|Assistant|Associate)\s+)*(?:Professor|Postdoctoral Researcher|Research Fellow|Lecturer)(?:\s+Emeritus)?\b/i)?.[0];
}

export function personResearch(person, { avatarFor, onOpenPerson }) {
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
    const identity = document.createElement('span');
    identity.className = 'map-person-research__identity';
    const name = document.createElement('strong');
    name.textContent = other.name;
    identity.append(name);
    const title = academicTitle(other.affiliation_text);
    if (title) {
      const role = document.createElement('span');
      role.className = 'map-person-research__role';
      role.textContent = title;
      identity.append(' ', role);
    }
    const topic = document.createElement('span');
    topic.className = 'map-person-research__topic';
    topic.textContent = `共同主題：${topics.join('、')}`;
    button.append(avatarFor(other), identity, topic);
    item.append(button);
    related.append(item);
  }
  let relatedSection;
  if (related.childElementCount) {
    relatedSection = document.createElement('section');
    relatedSection.className = 'map-person-research map-person-research--related';
    relatedSection.setAttribute('aria-label', '相關研究者');
    relatedSection.append(heading('相關研究者'), related);
  }
  return {
    keywords: keywordsSection.childElementCount ? keywordsSection : null,
    related: relatedSection,
  };
}
