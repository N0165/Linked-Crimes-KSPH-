const catalyst = require('zcatalyst-sdk-node');

module.exports = async (context, basicIO) => {
  const app = catalyst.initialize(context);
  const bucket = app.stratus().bucket('csv-imported');

  try {
    const res = await bucket.getObject('dashboard-data.json');
    let chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      basicIO.write(Buffer.concat(chunks).toString('utf8'));
      context.close();
    });
    res.on('error', (err) => {
      basicIO.write(JSON.stringify({ status: 'error', message: 'Cache read failed: ' + err.message }));
      context.close();
    });
  } catch (err) {
    basicIO.write(JSON.stringify({ status: 'error', message: err.message }));
    context.close();
  }
};