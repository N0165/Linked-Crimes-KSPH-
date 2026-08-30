const catalyst = require('zcatalyst-sdk-node');
const fs = require('fs');
const path = require('path');

module.exports = async (context, basicIO) => {
  const app = catalyst.initialize(context);
  const datastore = app.datastore();
  const events = JSON.parse(fs.readFileSync(path.join(__dirname, 'case_events.json'), 'utf8'));

  try {
    let inserted = 0;
    const chunkSize = 200;
    for (let i = 0; i < events.length; i += chunkSize) {
      const chunk = events.slice(i, i + chunkSize).map(e => ({
        case_id: e.case_id, seq: e.seq, event_date: e.event_date,
        event_type: e.event_type, description: e.description,
      }));
      await datastore.table('CaseEvents').insertRows(chunk);
      inserted += chunk.length;
    }
    basicIO.write(JSON.stringify({ status: 'success', inserted }));
  } catch (err) {
    basicIO.write(JSON.stringify({ status: 'error', message: err.message }));
  }
  context.close();
};