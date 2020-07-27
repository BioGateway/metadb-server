const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongojs = require('mongojs');

const databaseName = process.argv[2] || 'bgw-prod';
const db = mongojs(databaseName, ['all']);
const port = process.argv[3] || 3002;
const sentenceDB = mongojs('extri', ['all']);

const app = express();

// This will add timestamps to log messages.
console.logCopy = console.log.bind(console);
console.log = function(data)
{
	const currentDate = '[' + new Date().toLocaleString() + '] ';
	this.logCopy(currentDate, data);
};

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.listen(port, function () {
	console.log('Server started on port: '+port+' with database '+databaseName);
	db.prot.runCommand('count', function (err, res) {
		if (err) { console.log(err) }
		const count = res.n;
		console.log('Server connected to MongoDB. Total proteins: '+count);
	});
});

app.get('/test', function (req, res) {
	res.status(200).send('<h1>Connection Successful!</h1> <p>Successfully connected to BioGateway REST endpoint.</p>')
});

function getCollectionForUri(uri) {	
	if (uri.startsWith('http://rdf.biogateway.eu/prot/')) {
		return db.prot;
	} else if (uri.startsWith('http://purl.bioontology.org/ontology/OMIM/')) {
		return db.omim;
	} else if (uri.startsWith('http://rdf.biogateway.eu/gene/')) {
		return db.gene;
	} else if (uri.startsWith('http://purl.obolibrary.org/obo/GO_')) {
		return db.goall;
	} else if (uri.startsWith('http://purl.obolibrary.org/obo/NCBITaxon_')) {
		return db.taxon;
	} else if (uri.startsWith('http://purl.obolibrary.org/obo/PR_')) {
		return db.prot;
	} else if (uri.startsWith('http://rdf.biogateway.eu/prot-gene/')) {
		return db.tfac2gene;
	} else if (uri.startsWith('http://rdf.biogateway.eu/prot-prot/')) {
		return db.prot2prot;
	} else if (uri.startsWith('http://rdf.biogateway.eu/prot-obo/')) {
		return db.prot2onto;
	} else {
		return db.all;
	}
}

function getCollectionForType(type) {
	if (type === "protein") {
		return db.prot
	} else if (type === "disease") {
		return db.omim
	} else if (type === "all") {
		return db.all
	} else if (type === "gene") {
		return db.gene
	} else if (type === "go-term") {
		return db.goall
	} else if (type === "go-bp") {
		return db.gobp
	} else if (type === "go-cc") {
		return db.gocc
	} else if (type === "go-mf") {
		return db.gomf
	} else if (type === "taxon") {
		return db.taxon
	}
	return null
}

app.get('/findNodesWithFieldValue', function (req, res) {
	const field = req.query.field; // The field to search in.
	const value = req.query.value; // The value to match.
	const type = req.query.type; // The node type. I.e. "Protein" or "Gene".
	let limit = req.query.limit; // The max number of results.
	
	if (limit === null) {
		limit = 20;
	}


	if (!field) {
		res.status(400).send("<h1>400: Field not provided!</h1>");
		return
	}
	if (!value) {
		res.status(400).send("<h1>400: Value not provided!</h1>");
		return
	}
	if (!type) {
		res.status(400).send("<h1>400: Type not provided!</h1>");
		return
	}
	
	const collection = getCollectionForType(type);
	if (!collection) {
		res.status(400).send("<h1>400: Unsupported type: "+type+"</h1>");
		return
	}
	
	console.log("Searching "+type+"s for nodes with "+field+": "+value);
	const searchTerm = {};
	searchTerm[field] = value;
	
	collection.find(searchTerm).sort({ refScore : -1 }).limit(parseInt(limit), function (err, docs) {
		if (err) { 
			console.log(err);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		//console.log(docs);
		res.json(docs);
	});
});

app.post('/findNodesWithIdentifier', function (req, res) {
	const data = req.body;
	const values = data.values;
	const returnType = data.returnType;
	const type = data.nodeType;
	const collection = getCollectionForType(type);

	console.log("Searching in collection: " + collection);

	collection.find({ instances: { $in: values }}, function (err, docs) {
		if (err) {
			console.log(err);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		//console.log(docs);
		res.json(docs);
	});
});

app.post('/findNodesWithSynonyms', function (req, res) {
	const data = req.body;
	const values = data.values;
	const returnType = data.returnType;
	const type = data.nodeType;
	const taxa = data.taxa;
	const collection = getCollectionForType(type);
	
	console.log("Searching in collection: " + collection);

	// If taxa is defined, the query will be constrained by it.
	const searchTerm = taxa === undefined ? {$or: [{prefLabel: {$in: values}}, {lcSynonyms: {$in: values}}]} : {$and: [{$or: [{prefLabel: {$in: values}}, {lcSynonyms: {$in: values}}]}, {taxon: {$in: taxa}}]};

	collection.find(searchTerm, function (err, docs) {
		if (err) { 
			console.log(err);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		//console.log(docs);
		res.json(docs);
	});
});

app.post('/fetch', function (req, res) {
	let data = req.body;
	let uris = data.uris;
	if (!uris) uris = data.terms;
	const returnType = data.returnType;
	const type = data.nodeType;
	const extraFields = data.extraFields;

	const promises = [];

	for (i = 0; i < uris.length; i++) {
		const uri = uris[i];
		const collection = getCollectionForUri(uri);
		var node = new Promise(function (resolve, reject) {
			collection.findOne({_id: uri}, function (err, docs) {
				if (!docs) {
					resolve(null)
				}
				resolve(docs);
				});
			});
		
		promises.push(node);
	}
	
	Promise.all(promises).then(function (nodes) {
	// console.log("Nodes:");
	// 	console.log(nodes);
	// 	console.log(returnType);
		if (returnType === 'tsv') {
			let tsv = "uri\tprefLabel\tdescription";
			if (extraFields && extraFields.length) {
				for (const index in extraFields) {
					tsv += "\t"+extraFields[index];
				}
			}
			tsv += "\n";
			for (i = 0; i < nodes.length; i++) {
				const node = nodes[i];
				if (node != null) {
					tsv += node._id+'\t'+node.prefLabel+'\t'+node.definition;
					if (extraFields && extraFields.length) {
						for (const index in extraFields) {
							data = node[extraFields[index]];
							if (data) tsv += "\t"+data;
						}
					}
					tsv += '\n';
				}
			}
			res.send(tsv);
		} else {
			res.json(nodes);
		}
	});
});

app.post('/genesForSymbols', function (req, res) {
	const data = req.body;
	const symbols = data.terms;
	const returnType = data.returnType;

//	console.log(data);
	if (!symbols && !returnType) {
		res.status(400).send("<h1>400: Search terms or returnType not provided!</h1>");
		return
	}

	const promises = [];

	for (i = 0; i < symbols.length; i++) {
		const nodeMatches = new Promise(function (resolve, reject) {
			db.genes.find({prefLabel: symbols[i]}, function (err, docs) {
				if (!docs) {
					resolve(null)
				}
				resolve(docs);
			});
		});

		promises.push(nodeMatches);
	}
	
	Promise.all(promises).then(function (resolvedMatches) {
	// console.log("Nodes:");
	// 	console.log(nodes);
	// 	console.log(returnType);
		if (returnType === 'tsv') {
			let tsv = "uri\tprefLabel\tdescription\n";

			for (let matches of resolvedMatches) {
				for (let node of matches) {
					tsv += node._id+'\t'+node.prefLabel+'\t'+node.definition+'\t'+node.reviewed+'\n';
				}
			}
			res.send(tsv);
		} else {
			res.json(resolvedMatches);
		}
	});
});


app.post('/genesFromProt', function (req, res) {
	const data = req.body;
	const protUris = data.uris;
	const returnType = data.returnType;

//	console.log(data);
	if (!protUris && !returnType) {
		res.status(400).send("<h1>400: Search terms or returnType not provided!</h1>");
		return
	}

	const promises = [];

	for (i = 0; i < protUris.length; i++) {
		const nodeMatches = new Promise(function (resolve, reject) {
			db.genes.find({encodes: protUris[i]}, function (err, docs) {
				if (!docs) {
					resolve(null)
				}
				resolve(docs);
			});
		});

		promises.push(nodeMatches);
	}
	
	Promise.all(promises).then(function (resolvedMatches) {
	// console.log("Nodes:");
	// 	console.log(nodes);
	// 	console.log(returnType);
		if (returnType === 'tsv') {
			let tsv = "uri\tprefLabel\tdescription\n";

			for (let matches of resolvedMatches) {
				for (let node of matches) {
					tsv += node._id+'\t'+node.prefLabel+'\t'+node.definition+'\t'+node.reviewed+'\n';
				}
			}
			res.send(tsv);
		} else {
			res.json(resolvedMatches);
		}
	});
});

app.get('/fetch', function (req, res) {
	const uri = req.query.uri;
	const label = req.query.label;

	if (!uri && !label) {
		res.status(400).send("<h1>400: URI or label not provided!</h1>");
		return
	}
	
	if (uri) {
	console.log("Fetching : "+uri);
	
	const collection = getCollectionForUri(uri);

	collection.findOne({_id: uri}, function (err, docs) {
		if (err) { 
			console.log(err);
			return
		}
		if (!docs) {
			console.log(uri + ' not found in ' + collection._name);
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		res.json(docs);
		});
	}
	if (label) {
		console.log("Fetching: "+label);

		db.proteins.findOne({prefLabel: label}, function (err, docs) {
			if (err) { 
				console.log(err);
				return
			}
			if (!docs) {
				console.log('No results found for ' + label + ' in collection ');
				res.status(404).send('<h1>404: Node not found.</h1>');
				return
			}
			//console.log(docs);
			res.json(docs);
			});
	}
});

app.get('/getGenexMetadataFromIDs', function (req, res) {

	const pubmedId = req.query.pubmedId;
	const tfSymbol = req.query.tf;
	const tgSymbol = req.query.tg;
	const limit = 20;

	if (!pubmedId) {
		if (!(tfSymbol && tgSymbol)) {
			res.status(400).send("<h1>400: PubmedID or both TF and TG must be provided!</h1>");
			return
		}
	}


	const collection = sentenceDB.sentences;

	if (tfSymbol && tgSymbol) {
		// Search for specific pubmedId for specific interaction:
		
		console.log("Searching for sentences between "+tfSymbol+" and "+tgSymbol+".");
		collection.find({pubmedId: pubmedId, TF: tfSymbol, TG: tgSymbol}, function (err, docs) {
			if (err) {
				console.log(err);
				return
			}
			if (!docs) {
				res.status(404).send('<h1>404: Data not found.</h1>');
				return
			}
			//console.log(docs);
			res.json(docs);
		});
	} else if (pubmedId) {
		// Search using PubmedID:
		collection.find({pubmedId: pubmedId}, function (err, docs) {
			if (err) {
				console.log(err);
				return
			}
			if (!docs) {
				res.status(404).send('<h1>404: Data not found.</h1>');
				return
			}
			//console.log(docs);
			res.json(docs);
		});
	} else {
		res.status(404).send('<h1>404: Data not found.</h1>');

	}
});



app.get('/getGenexMetadata', function (req, res) {


	const pubmedId = req.query.pubmedId;
	const tf = req.query.tf;
	const tg = req.query.tg;
	const limit = 20;

	console.log('Fetching TF-TG Metadata for relation between '+tf+' and '+tg+' with PubMed ID: '+pubmedId);


	if (!pubmedId) {
		if (!(tf && tg)) {
			res.status(400).send("<h1>400: PubmedID or both TF and TG must be provided!</h1>");
			return
		}
	}

	const collection = sentenceDB.sentences;

	if (pubmedId && tf && tg) {
		// Search for specific pubmedId for specific interaction:
		collection.find({pubmedId: pubmedId, TF: tf, TG: tg}, function (err, docs) {
			if (err) {
				console.log(err);
				return
			}
			if (!docs) {
				res.status(404).send('<h1>404: Data not found.</h1>');
				return
			}
			console.log('Found docs:');
			console.log(docs);
			res.json(docs);
		});
	} else if (pubmedId) {
		// Search using PubmedID:
		collection.find({pubmedId: pubmedId}, function (err, docs) {
			if (err) {
				console.log(err);
				return
			}
			if (!docs) {
				res.status(404).send('<h1>404: Data not found.</h1>');
				return
			}
			console.log('Found docs:');
			console.log(docs);
			res.json(docs);
		});
	} else {
		// Search using TF and TG:
		collection.find({TF: tf, TG: tg}, function (err, docs) {
			if (err) {
				console.log(err);
				return
			}
			if (!docs) {
				res.status(404).send('<h1>404: Data not found.</h1>');
				return
			}
			console.log(docs);
			res.json(docs);
		});
	}

});

app.get('/prefixPrefLabelSearch', function (req, res) {
	const term = req.query.term;
	const type = req.query.type;
	let limit = 20;

	console.log("Searching for term: "+term+" of type: "+type);
	
	if (limit === null) {
		limit = 20;
	}
	
	if (!term) {
		res.status(400).send("<h1>400: Term not provided!</h1>");
		return
	}
	if (!type) {
		res.status(400).send("<h1>400: Type not provided!</h1>");
		return
	}
	
	const collection = getCollectionForType(type);
	if (!collection) {
		res.status(400).send("<h1>400: Unsupported type: "+type+"</h1>");
		return
	}
	
	console.log("Searching for nodes starting with: "+term);
	const regexTerm = new RegExp('^' + term);

	collection.find({prefLabel: { $regex: regexTerm }}).sort({ fromScore : -1 }).limit(parseInt(limit), function (err, docs) {
		if (err) { 
			console.log(err);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		//console.log(docs);
		res.json(docs);
	});
});

app.get('/prefixLabelSearch', function (req, res) {
	const term = req.query.term;
	const type = req.query.type;
	let limit = 20;

	console.log("Searching for term: "+term+" of type: "+type);
	
	if (limit === null) {
		limit = 20;
	}
	
	if (!term) {
		res.status(400).send("<h1>400: Term not provided!</h1>");
		return
	}
	if (!type) {
		res.status(400).send("<h1>400: Type not provided!</h1>");
		return
	}
	
	const collection = getCollectionForType(type);
	if (!collection) {
		res.status(400).send("<h1>400: Unsupported type: "+type+"</h1>");
		return
	}
	
	console.log("Searching for nodes starting with: "+term);
	const regexTerm = new RegExp('^' + term.toLowerCase());

	const searchTerm = {$or: [{lcLabel: regexTerm}, {lcSynonyms: regexTerm}, {_id: term}]};

	collection.find(searchTerm).sort({ fromScore : -1 }).limit(parseInt(limit), function (err, docs) {
		if (err) {
			console.log(err);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		//console.log(docs);
		res.json(docs);
	});
});

app.get('/downloadLabels', function (req, res) {
	const type = req.query.type;
	const format = req.query.format;

	const collection = db[type];
	if (!collection) {
		res.status(400).send("<h1>400: Unsupported type: "+type+"</h1>");
		return
	}

	collection.find({}, {prefLabel: 1}, function (err, docs) {
		if (err) {
			console.log(err);
			res.status(500);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: No data found.</h1>');
			return
		}
		if (format === 'tsv') {
			let tsv = "label\turi\n";

			for (i = 0; i < docs.length; i++) {
				const node = docs[i];
				if (node != null) {
					tsv += `${node.prefLabel}\t${node._id}\n`;
				}
			}
			res.send(tsv);
		} else {
			res.json(docs);
		}
	})
});

app.post('/prefixLabelSearch', function (req, res) {
	const data = req.body;
	const taxa = data.taxa;
	const type = data.type;
	const term = data.term;

	const limit = 20;

	console.log("Searching for term: "+term+" of type: "+type);

	if (!term) {
		res.status(400).send("<h1>400: Term not provided!</h1>");
		return
	}
	if (!type) {
		res.status(400).send("<h1>400: Type not provided!</h1>");
		return
	}

	const collection = getCollectionForType(type);
	if (!collection) {
		res.status(400).send("<h1>400: Unsupported type: "+type+"</h1>");
		return
	}

	console.log("Searching for nodes starting with: "+term);
	const regexTerm = new RegExp('^' + term.toLowerCase());
	const searchTerm = taxa === undefined ? {$or: [{lcLabel: regexTerm}, {lcSynonyms: regexTerm}, {_id: term}]} : {$and: [{$or: [{lcLabel: regexTerm}, {lcSynonyms: regexTerm}]}, {taxon: {$in: taxa}}]};

	collection.find(searchTerm).sort({ fromScore : -1 }).limit(parseInt(limit), function (err, docs) {
		if (err) {
			console.log(err);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		//console.log(docs);
		res.json(docs);
	});
});



app.get('/labelSearch', function (req, res) {
	const term = req.query.term;
	const type = req.query.type;
	let limit = req.query.limit;

	if (limit === null) {
		limit = 20;
	}
	
	if (!term) {
		res.status(400).send("<h1>400: Term not provided!</h1>");
		return
	}
	if (!type) {
		res.status(400).send("<h1>400: Type not provided!</h1>");
		return
	}
	
	const collection = getCollectionForType(type);
	if (!collection) {
		res.status(400).send("<h1>400: Unsupported type: "+type+"</h1>");
		return
	}
	
	console.log("Searching "+type+"s for nodes containing: "+term);
	const regexTerm = new RegExp(term, 'i');
	//$or: [{ lcLabel: regexTerm }, { synonyms: regexTerm }]
	//collection.find({prefLabel: { $regex: regexTerm }}).sort({ refScore : -1 }).limit(parseInt(limit), function (err, docs) {
	collection.find({$or: [{ prefLabel: { $regex: regexTerm } }, { _id: term }]}).sort({ refScore : -1 }).limit(parseInt(limit), function (err, docs) {
		if (err) {
			console.log(err);
			return
		}
		if (!docs) {
			res.status(404).send('<h1>404: Node not found.</h1>');
			return
		}
		//console.log(docs);
		res.json(docs);
	});
});

