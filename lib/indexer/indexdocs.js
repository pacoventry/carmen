var fork = require('child_process').fork;
var cpus = require('os').cpus().length;
var TIMER = process.env.TIMER;
module.exports = indexdocs;

function indexdocs(docs, freq, zoom, callback) {
    for (var i = 0; i < docs.length; i++) {
        var doc = docs[i];
        if (!doc._id) return callback(new Error('doc has no _id'));
        if (!doc._text) return callback(new Error('doc has no _text on _id:' + doc._id));
        if (!doc._center && !doc._geometry) return callback(new Error('doc has no _center or _geometry on _id:' + doc._id));
        if(!doc._zxy || doc._zxy.length === 0) {
            if(typeof zoom != 'number') return callback(new Error('index has no zoom on _id:'+doc.id));
            if(zoom < 0) return callback(new Error('zoom must be greater than 0 --- zoom was '+zoom+' on _id:'+doc.id));
            if(zoom > 14) return callback(new Error('zoom must be less than 15 --- zoom was '+zoom+' on _id:'+doc.id));
        }
    }

    var workers = [];
    var remaining = docs.length;
    var full = { grid: {}, term: {}, phrase: {}, degen: {}, docs:[] };
    var types = Object.keys(full);
    var patches = [];

    // Setup workers.
    for (var i = 0; i < cpus; i++) {
        workers[i] = fork(__dirname + '/indexdocs-worker.js');
        workers[i].send({freq:freq, zoom:zoom});
        workers[i].on('exit', exit);
        workers[i].on('message', function(patch) {
            patches.push(patch);
            if (patches.length >= 10000) {
                if (TIMER) console.time('indexdocs:processPatch');
                while (patches.length) processPatch(patches.shift(), types, full);
                if (TIMER) console.timeEnd('indexdocs:processPatch');
            }
            if (!--remaining) {
                while (patches.length) processPatch(patches.shift(), types, full);
                endProcessing(workers, full, callback);
            }
        });
    }

    // Send docs to workers.
    if (TIMER) console.time('indexdocs:send');
    for (var i = 0; i < docs.length; i++) {
        workers[i%cpus].send(docs[i]);
    }
    if (TIMER) console.timeEnd('indexdocs:send');
}

function exit(code) {
    if (!code) return;
    console.warn('Index worker exited with ' + code);
    process.exit(code);
}

function processPatch (patch, types, full) {
    full.docs.push(patch.docs);

    for (var i = 0; i < types.length; i++) {
        var type = types[i];
        for (var k in patch[type]) {
            if (type === 'phrase') {
                full[type][k] = full[type][k] || patch[type][k];
            } else if (type !== 'docs') {
                full[type][k] = full[type][k] || [];
                full[type][k].push.apply(full[type][k], patch[type][k]);
            }
        }
    }
}

function endProcessing (workers, full, callback) {
    // kill all the workers
    workers.forEach(function(w) { w.kill('SIGHUP'); });
    // Final validation that indexing succeeded.
    callback(null, full);
}