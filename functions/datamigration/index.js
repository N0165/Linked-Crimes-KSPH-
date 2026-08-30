const catalyst = require('zcatalyst-sdk-node');
const fs = require('fs');
const path = require('path');

module.exports = async (context, basicIO) => {
  const app = catalyst.initialize(context);
  const datastore = app.datastore();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

  async function bulkInsert(tableName, rows, chunkSize = 200) {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await datastore.table(tableName).insertRows(chunk);
      inserted += chunk.length;
    }
    return inserted;
  }

  const results = {};
  try {
    results.Districts = await bulkInsert('Districts', data.districts.map(x => ({
      district_id: x.id, name: x.name, lat: String(x.lat), lng: String(x.lng)
    })));

    results.Units = await bulkInsert('Units', data.units.map(x => ({
      unit_id: x.id, name: x.name, district_id: x.districtId, lat: String(x.lat), lng: String(x.lng)
    })));

    results.CrimeHeads = await bulkInsert('CrimeHeads', data.crimeHeads.map(x => ({
      head_id: x.id, name: x.name
    })));

    results.CrimeSubHeads = await bulkInsert('CrimeSubHeads', data.crimeSubHeads.map(x => ({
      subhead_id: x.id, head_id: x.headId, name: x.name
    })));

    results.Cases = await bulkInsert('Cases', data.cases.map(c => ({
      case_id: c.id, crime_no: c.crimeNo, case_category: c.caseCategory,
      registered_date: c.registeredDate, unit_id: c.unitId, district_id: c.districtId,
      crime_head_id: c.crimeHeadId, crime_subhead_id: c.crimeSubHeadId,
      gravity: c.gravity, status: c.status, lat: String(c.lat), lng: String(c.lng),
      brief_facts: c.briefFacts
    })));

    let accused = [];
    data.cases.forEach(c => c.accused.forEach(a => accused.push({
      case_id: c.id, name: a.name, age: a.age, gender: a.gender,
      person_id: a.personId, entity_key: a.entityKey
    })));
    results.Accused = await bulkInsert('Accused', accused);

    let victims = [];
    data.cases.forEach(c => c.victims.forEach(v => victims.push({
      case_id: c.id, name: v.name, age: v.age, gender: v.gender
    })));
    results.Victims = await bulkInsert('Victims', victims);

    let complainants = [];
    data.cases.forEach(c => (c.complainants || []).forEach(cp => complainants.push({
      case_id: c.id, name: cp.name, occupation: cp.occupation || ''
    })));
    results.Complainants = await bulkInsert('Complainants', complainants);

    basicIO.write(JSON.stringify({ status: 'success', results }));
  } catch (err) {
    basicIO.write(JSON.stringify({ status: 'error', message: err.message, results }));
  }
  context.close();
};