import universities from '../data/institutions/universities.json';

const nycu = universities.find(({ name }) => name === '國立陽明交通大學');
const guangfu = nycu.campuses.find(({ name }) => name === '新竹光復校區');
const guangfuNames = new Set([nycu.name, '國立交通大學', '國立陽明交通大學光復校區']);
const nycuNamedCampuses = new Map([
  ['國立陽明交通大學臺北陽明校區', '臺北陽明校區'],
  ['國立陽明交通大學六家校區', '六家校區'],
]);

export const unitInstitutionAliases = {
  國立臺灣師範大學: ['師大', '國立臺灣師大'],
  [nycu.name]: ['國立交通大學', '交通大學', '交大', '國立陽明大學', '陽明大學'],
};

export function officialCampus(institution, name) {
  const school = universities.find((school) => school.name === institution);
  const campus = school?.campuses.find((campus) => campus.name === name);
  if (!campus?.coordinate_source_url) return null;
  return {
    institution,
    campus: campus.name,
    country: '臺灣',
    city: campus.county,
    lat: campus.lat,
    lon: campus.lon,
    source_url: campus.coordinate_source_url,
    address_source_url: campus.source_url,
    address: campus.address,
  };
}

export function canonicalCampus(point) {
  if (point.country !== '臺灣') return point;
  const named = officialCampus(nycu.name, nycuNamedCampuses.get(point.institution));
  if (named?.city === point.city) return { ...point, ...named };
  if (guangfuNames.has(point.institution) && point.city === guangfu.county &&
      Math.abs(point.lat - guangfu.lat) <= 0.0001 && Math.abs(point.lon - guangfu.lon) <= 0.0001) {
    return { ...point, ...officialCampus(nycu.name, guangfu.name) };
  }
  return point;
}
