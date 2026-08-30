
const catalyst = require('zcatalyst-sdk-node');

async function fetchAllRows(datastore, tableName) {
  let rows = [];
  let nextToken = undefined;
  let more = true;

  while (more) {
    const request = {
      maxRows: 200,
    };

    if (nextToken) {
      request.nextToken = nextToken;
    }

    console.log(
      `Fetching table "${tableName}"${nextToken ? ' - next page' : ' - first page'}...`
    );

    const resp = await datastore.table(tableName).getPagedRows(request);

    console.log(
      `Response keys for "${tableName}":`,
      Object.keys(resp)
    );

    if (resp && Array.isArray(resp.data)) {
      rows = rows.concat(resp.data);
    }

    // Support either SDK response naming convention.
    more =
      resp.moreRecords === true ||
      resp.more_records === true;

    nextToken =
      resp.nextToken ||
      resp.next_token;

    console.log(
      `"${tableName}" pagination: rows=${rows.length}, more=${more}, hasToken=${!!nextToken}`
    );

    if (more && !nextToken) {
      console.error(
        `Full response from "${tableName}":`,
        JSON.stringify(resp, null, 2)
      );

      throw new Error(
        `Pagination error while fetching table "${tableName}": more records exist but no pagination token was returned.`
      );
    }
  }

  console.log(`Finished "${tableName}": ${rows.length} rows`);

  return rows;
}

module.exports = async (cronDetails, context) => {
  try {
    const app = catalyst.initialize(context);
    const datastore = app.datastore();
    const bucket = app.stratus().bucket('csv-imported');

    console.log('Starting buildcache...');

    const districts = await fetchAllRows(datastore, 'Districts');
    const units = await fetchAllRows(datastore, 'Units');
    const crimeHeads = await fetchAllRows(datastore, 'CrimeHeads');
    const crimeSubHeads = await fetchAllRows(datastore, 'CrimeSubHeads');
    const cases = await fetchAllRows(datastore, 'Cases');
    const accused = await fetchAllRows(datastore, 'Accused');
    const victims = await fetchAllRows(datastore, 'Victims');
    const complainants = await fetchAllRows(datastore, 'Complainants');
    const caseEvents = await fetchAllRows(datastore, 'CaseEvents');

    const accusedByCase = {};

    accused.forEach(a => {
      (accusedByCase[a.case_id] =
        accusedByCase[a.case_id] || []).push({
          id: `${a.case_id}-${a.person_id}`,
          name: a.name,
          age: Number(a.age),
          gender: a.gender,
          personId: a.person_id,
          entityKey: a.entity_key,
        });
    });

    const victimsByCase = {};

    victims.forEach(v => {
      (victimsByCase[v.case_id] =
        victimsByCase[v.case_id] || []).push({
          id: `${v.case_id}-V`,
          name: v.name,
          age: Number(v.age),
          gender: v.gender,
        });
    });

    const complainantsByCase = {};

    complainants.forEach(cp => {
      (complainantsByCase[cp.case_id] =
        complainantsByCase[cp.case_id] || []).push({
          id: `${cp.case_id}-C`,
          name: cp.name,
          occupation: cp.occupation,
        });
    });

    const eventsByCase = {};

    caseEvents.forEach(e => {
      (eventsByCase[e.case_id] =
        eventsByCase[e.case_id] || []).push({
          seq: Number(e.seq),
          date: e.event_date,
          type: e.event_type,
          description: e.description,
        });
    });

    Object.values(eventsByCase).forEach(list =>
      list.sort((a, b) => a.seq - b.seq)
    );

    const outCases = cases.map(c => ({
      id: Number(c.case_id),
      crimeNo: c.crime_no,
      caseCategory: c.case_category,
      registeredDate: c.registered_date,
      unitId: Number(c.unit_id),
      districtId: Number(c.district_id),
      crimeHeadId: Number(c.crime_head_id),
      crimeSubHeadId: Number(c.crime_subhead_id),
      gravity: c.gravity,
      status: c.status,
      lat: parseFloat(c.lat),
      lng: parseFloat(c.lng),
      briefFacts: c.brief_facts,
      accused: accusedByCase[c.case_id] || [],
      victims: victimsByCase[c.case_id] || [],
      complainants: complainantsByCase[c.case_id] || [],
      timeline: eventsByCase[c.case_id] || [],
      sections: [],
      arrests: [],
    }));

    const out = {
      generatedAt: new Date().toISOString(),

      districts: districts.map(d => ({
        id: Number(d.district_id),
        name: d.name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lng),
      })),

      units: units.map(u => ({
        id: Number(u.unit_id),
        name: u.name,
        districtId: Number(u.district_id),
        lat: parseFloat(u.lat),
        lng: parseFloat(u.lng),
      })),

      crimeHeads: crimeHeads.map(h => ({
        id: Number(h.head_id),
        name: h.name,
      })),

      crimeSubHeads: crimeSubHeads.map(s => ({
        id: Number(s.subhead_id),
        headId: Number(s.head_id),
        name: s.name,
      })),

      cases: outCases,

      excludedFields: ['CasteID', 'ReligionID'],
    };

    const jsonBuffer = Buffer.from(JSON.stringify(out));

    await bucket.putObject(
      'dashboard-data.json',
      jsonBuffer,
      {
        'content-type': 'application/json',
      }
    );

    console.log(
      `Cache rebuilt successfully: ${outCases.length} cases, ${jsonBuffer.length} bytes`
    );

  } catch (err) {
    console.error('buildcache failed:', err);
    throw err;
  } finally {
    // Only close the context if the method exists.
    if (context && typeof context.close === 'function') {
      context.close();
    }
  }
};
