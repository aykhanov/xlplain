// SQLite в отдельном потоке: база пересоздаётся перед каждым запросом, поэтому DELETE и DROP ничего не ломают.
importScripts('sql-wasm.js');
var ready = initSqlJs({ locateFile: function (f) { return f; } });
var images = {};
function image(SQL, name) {
  if (images[name]) return Promise.resolve(images[name]);
  return fetch(name + '.sql').then(function (r) { return r.text(); }).then(function (dump) {
    var d = new SQL.Database(); d.run(dump); images[name] = d.export(); d.close(); return images[name];
  });
}
onmessage = function (e) {
  var m = e.data;
  ready.then(function (SQL) {
    return image(SQL, m.db).then(function (bytes) {
      var results = m.queries.map(function (q) {
        var d = new SQL.Database(bytes);
        try {
          var r = d.exec(q); var last = r[r.length - 1];
          return { ok: true, columns: last ? last.columns : [], values: last ? last.values : [] };
        } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
        finally { d.close(); }
      });
      postMessage({ id: m.id, results: results });
    });
  }).catch(function (err) { postMessage({ id: m.id, fatal: String(err && err.message || err) }); });
};
