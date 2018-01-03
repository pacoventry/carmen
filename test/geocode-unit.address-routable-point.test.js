// Ensures that relev takes into house number into consideration
// Also ensure relev is applied to US & Non-US Style addresses

const tape = require('tape');
const Carmen = require('..');
const context = require('../lib/context');
const mem = require('../lib/api-mem');
const queue = require('d3-queue').queue;
const addFeature = require('../lib/util/addfeature'),
    queueFeature = addFeature.queueFeature,
    buildQueued = addFeature.buildQueued;

// Test geocoder_address formatting + return place_name as germany style address (address number follows name)
(() => {
    const conf = {
        address: new mem({maxzoom: 6,  geocoder_address:1, geocoder_format: '{address._number} {address._name} {place._name}, {region._name} {postcode._name}, {country._name}'}, () => {}),
    };
    const c = new Carmen(conf);
    tape('index address', (t) => {
        let address = {
            id:1,
            properties: {
                'carmen:text': 'fake street',
                'carmen:center': [0,0],
                'carmen:addressnumber': [null, ['9','10','7']]
            },
            geometry: {
                type: "GeometryCollection",
                geometries: [
                    {
                        type: "MultiLineString",
                        coordinates: [
                            [
                                [1.111, 1.11],
                                [1.112, 1.11],
                                [1.114, 1.11],
                                [1.115, 1.11]
                            ]
                        ]
                    },
                    {
                        type: "MultiPoint",
                        coordinates: [[1.111, 1.111], [1.113, 1.111], [1.115, 1.111]]
                    }
                ]
            }
        }
        queueFeature(conf.address, address, () => { buildQueued(conf.address, t.end) });
    });

    tape('Search for us style address, return with german formatting', (t) => {
        c.geocode('9 fake street', { limit_verify: 1 }, (err, res) => {
            t.ifError(err);
            t.end();
        });
    });
})();


tape('teardown', (t) => {
    context.getTile.cache.reset();
    t.end();
});
