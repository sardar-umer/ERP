const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.production' });
(async () => {
  const uri = process.env.MONGODB_URI.replace(':27017', ':27018');
  const c = new MongoClient(uri, { directConnection: true });
  await c.connect(); const db = c.db('sgc_erp');
  const u = await db.collection('users').findOne({ email: /faisalfarooq@tovus\.net/i });
  console.log(JSON.stringify({ _id: u?._id, name: [u?.firstName, u?.lastName], role: u?.role, dept: u?.department, desig: u?.designation }));
  const id = u._id; const ids = id.toString();
  const cols = await db.listCollections().toArray();
  for (const col of cols) {
    const coll = db.collection(col.name);
    // find docs containing id anywhere: use $where-free approach: sample by JSON string search via aggregation is heavy; use generic scan of field paths
    let n = 0; const paths = {};
    const cur = coll.find({}, {});
    for await (const d of cur) {
      const walk = (o, p) => {
        if (o == null) return;
        if (o._bsontype === 'ObjectId' || o._bsontype === 'ObjectID') { if (o.toString() === ids) paths[p] = (paths[p]||0)+1; return; }
        if (typeof o === 'string') { if (o === ids) paths[p] = (paths[p]||0)+1; return; }
        if (o instanceof Date || Buffer.isBuffer(o)) return;
        if (Array.isArray(o)) { o.forEach(x => walk(x, p + '[]')); return; }
        if (typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p ? p + '.' + k : k);
      };
      const before = JSON.stringify(paths); walk(d, ''); if (JSON.stringify(paths) !== before) n++;
    }
    if (n) console.log(col.name, n, JSON.stringify(paths));
  }
  await c.close();
})();
