'use strict';
const termops = require('./util/termops');
const token = require('./util/token');
const bb = require('./util/bbox');
const cl = require('./util/closest-lang');
const filter = require('./util/filter');

/**
* phrasematch
*
* @param {Object} source a Geocoder datasource
* @param {Array} query a list of terms composing the query to Carmen
* @param {Function} callback called with `(err, features, result, stats)`
*/
module.exports = function phrasematch(source, query, options, callback) {
    options = options || {};
    options.autocomplete = options.autocomplete || false;
    options.bbox = options.bbox || false;
    const tokenized = termops.tokenize(token.replaceToken(source.token_replacer, query));

    // if requested country isn't included, skip
    if (options.stacks) {
        const stackAllowed = filter.sourceMatchesStacks(source, options);
        if (!stackAllowed) return callback(null, new PhrasematchResult([], source));
    }

    // if not in bbox, skip
    if (options.bbox) {
        const intersects = bb.intersect(options.bbox, source.bounds);
        if (!intersects) return callback(null, new PhrasematchResult([], source));
    }

    // Get all subquery permutations from the query
    let subqueries = termops.permutations(tokenized);

    // Include housenum tokenized permutations if source has addresses
    if (source.geocoder_address) {
        const numTokenized = termops.numTokenize(tokenized, source.version);
        for (let i = 0; i < numTokenized.length; i++) {
            subqueries = subqueries.concat(termops.permutations(numTokenized[i]));
        }
    }

    subqueries = termops.uniqPermutations(subqueries);
    const dawg = source._dictcache;

    // load up scorefactor used at indexing time.
    // it will be used to scale scores for approximated
    // cross-index comparisons.
    const scorefactor = (source._geocoder.freq.get('__MAX__') || [0])[0] || 1;

    const phrasematches = [];

    let l = subqueries.length;
    while (l--) {
        const subquery = subqueries[l];
        const text = termops.encodableText(subquery);
        if (text) {
            const scanPrefix = subquery.ender && options.autocomplete;

            // only try text normalization if this index has it enabled, and if either we're not doing autocomplete or, if we are, the text is at least 3 chars long
            // (so th process isn't totally batshit slow)
            const tryNormalization = source.use_normalization_cache && (!scanPrefix || text.length >= 3);
            const dawgMatch = tryNormalization ?
                dawg.hasPhraseOrNormalizations(text, scanPrefix) :
                dawg.hasPhrase(text, scanPrefix);

            if (!dawgMatch) continue;

            let variants;
            if (!tryNormalization) {
                variants = [{ text: subquery.join(' '), prefix: scanPrefix }];
            } else if (scanPrefix) {
                variants = [{ text: subquery.join(' '), prefix: scanPrefix }];
                for (const v of dawgMatch.normalizations) {
                    variants.push({ text: v, prefix: false });
                }
            } else {
                variants = dawgMatch.normalizations.length ? dawgMatch.normalizations.map((n) => { return { text: n, prefix: scanPrefix }; }) : [{ text: subquery.join(' '), prefix: scanPrefix }];
            }

            for (const variant of variants) {
                // Augment permutations with matched grids,
                // index position and weight relative to input query.
                const phrase = termops.encodePhrase(variant.text);
                // use the original subquery to calculate weight, in case the variant has a different cardinality
                const weight = subquery.length / tokenized.length;

                const prefix = (variant.prefix && !(source.geocoder_address && termops.isAddressNumber(text)));

                let languages;
                if (options.language) {
                    languages = [options.language[0]];
                } else {
                    // this may not be what we want to do here
                    // if effectively treats 'default' as its own language, and a lack of
                    // specified language flag as a search over this language
                    // we could alternatively search all languages here by setting this field
                    // to undefined, or emply some other strategy
                    languages = ['default'];
                }
                languages = languages.map((l) => {
                    // use the built-in language if we have it
                    if (source.lang.lang_map.hasOwnProperty(l)) {
                        return source.lang.lang_map[l];
                    } else {
                        const label = cl.closestLangLabel(l, source.lang.lang_map);
                        return source.lang.lang_map[label || 'unmatched'];
                    }
                });

                phrasematches.push(new Phrasematch(variant.text.split(' '), weight, subquery.mask, phrase, scorefactor, source.idx, source._geocoder.grid, source.zoom, prefix, languages));
            }
        }
    }

    return callback(null, new PhrasematchResult(phrasematches, source));
};

module.exports.PhrasematchResult = PhrasematchResult;
function PhrasematchResult(phrasematches, source) {
    this.phrasematches = phrasematches;
    this.idx = source.idx;
    this.nmask = 1 << source.ndx;
    this.bmask = source.bmask;
}

module.exports.Phrasematch = Phrasematch;
function Phrasematch(subquery, weight, mask, phrase, scorefactor, idx, cache, zoom, prefix, languages) {
    this.subquery = subquery;
    this.weight = weight;
    this.mask = mask;
    this.phrase = phrase;
    this.scorefactor = scorefactor;
    this.prefix = prefix;
    this.languages = languages;

    // Attributes used by carmen-cache.
    // All phrasematches from the same source have the same values.
    this.idx = idx;
    this.cache = cache;
    this.zoom = zoom;
}

Phrasematch.prototype.clone = function() {
    return new Phrasematch(this.subquery.slice(), this.weight, this.mask, this.phrase, this.scorefactor, this.idx, this.cache, this.zoom, this.prefix, this.languages);
};

