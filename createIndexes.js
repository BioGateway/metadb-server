db.prot.createIndexes([
    { "definition": "text" },
    {"lcLabel": 1 },
    {"prefLabel": 1 },
    {"refScore": -1 },
    {"lcSynonyms": 1 },
    {"synonyms": 1 }
]);
db.gene.createIndexes([
    { "definition": "text" },
    {"lcLabel": 1 },
    {"prefLabel": 1 },
    {"refScore": -1 },
    {"lcSynonyms": 1 },
    {"synonyms": 1 }
]);
db.goall.createIndexes([
    { "definition": 1 },
    {"lcLabel": "text" },
    {"prefLabel": 1 },
    {"refScore": -1 },
    {"lcSynonyms": 1 },
    {"synonyms": 1 }
]);
