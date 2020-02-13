var express = require('express');
var cors = require('cors');
var bodyParser = require('body-parser');
var mongojs = require('mongojs');
var db = mongojs('bgw-cache', ['all']);
var sentenceDB = mongojs('biogw-dict', ['all']);
var path = require('path');

const port = 3002;

var app = express();

// This will add timestamps to log messages.
console.logCopy = console.log.bind(console);
console.log = function(data)
{
    var currentDate = '[' + new Date().toLocaleString() + '] ';
    this.logCopy(currentDate, data);
};

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.listen(port, function () {
	console.log('Server started on port: '+port);
	db.prot.runCommand('count', function (err, res) {
		if (err) { console.log(err) }
		var count = res.n;
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
		return db.go;
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
		return db.go
	} else if (type === "taxon") {
		return db.taxon
	}
	return null
}

app.get('/findNodesWithFieldValue', function (req, res) {
	var field = req.query.field; // The field to search in.
	var value = req.query.value; // The value to match.
	var type = req.query.type; // The node type. I.e. "Protein" or "Gene".
	var limit = req.query.limit; // The max number of results.
	
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
	var searchTerm = {};
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
	const collection = getCollectionForType(type)

	console.log("Searching in collection: " + collection);

	collection.find({ identifiers: { $in: values }}, function (err, docs) {
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
	const collection = getCollectionForType(type)
	
	console.log("Searching in collection: " + collection);

	collection.find({ $or: [{ prefLabel: { $in: values }}, { synonyms: { $in: values }}]}, function (err, docs) {
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
	var data = req.body;
	var uris = data.uris;
	if (!uris) uris = data.terms;
	var returnType = data.returnType;
	var type = data.nodeType;
	var extraFields = data.extraFields;
	
	var promises = [];
	
	for (i = 0; i < uris.length; i++) {
		var uri = uris[i];
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
			var tsv = "uri\tprefLabel\tdescription";
			if (extraFields && extraFields.length) {
				for (index in extraFields) {
					tsv += "\t"+extraFields[index];
				}
			}
			tsv += "\n";
			for (i = 0; i < nodes.length; i++) {
				var node = nodes[i];
				if (node != null) {
					tsv += node._id+'\t'+node.prefLabel+'\t'+node.definition;
					if (extraFields && extraFields.length) {
						for (index in extraFields) {
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
	var data = req.body;
	var symbols = data.terms;
	var returnType = data.returnType;
	
//	console.log(data);
	if (!symbols && !returnType) {
		res.status(400).send("<h1>400: Search terms or returnType not provided!</h1>");
		return
	}
	
	var promises = [];
	
	for (i = 0; i < symbols.length; i++) {
		var nodeMatches = new Promise(function (resolve, reject) {
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
			var tsv = "uri\tprefLabel\tdescription\n";
			
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
	var data = req.body;
	var protUris = data.uris;
	var returnType = data.returnType;
	
//	console.log(data);
	if (!protUris && !returnType) {
		res.status(400).send("<h1>400: Search terms or returnType not provided!</h1>");
		return
	}
	
	var promises = [];
	
	for (i = 0; i < protUris.length; i++) {
		var nodeMatches = new Promise(function (resolve, reject) {
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
			var tsv = "uri\tprefLabel\tdescription\n";
			
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
	var uri = req.query.uri;
	var label = req.query.label;
	
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
				res.status(404).send('<h1>404: Node not found.</h1>');
				return
			}
			//console.log(docs);
			res.json(docs);
			});
	}
});

app.get('/getGenexMetadataFromIDs', function (req, res) {

	var pubmedId = req.query.pubmedId;
	var tfSymbol = req.query.tf;
	var tgSymbol = req.query.tg;
	var limit = 20;
	
	if (!pubmedId) {
		if (!(tfSymbol && tgSymbol)) {
			res.status(400).send("<h1>400: PubmedID or both TF and TG must be provided!</h1>");
			return
		}
	}
	
	

	var collection = sentenceDB.metadata_genex;

	if (tfSymbol && tgSymbol) {
		// Search for specific pubmedId for specific interaction:
		
		console.log("Searching for sentences between "+tfSymbol+" and "+tgSymbol+".")
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
		return
	}
});



app.get('/getGenexMetadata', function (req, res) {


	var pubmedId = req.query.pubmedId;
	var tf = req.query.tf;
	var tg = req.query.tg;
	var limit = 20;

	console.log('Fetching TF-TG Metadata for relation between '+tf+' and '+tg+' with PubMed ID: '+pubmedId);


	if (!pubmedId) {
		if (!(tf && tg)) {
			res.status(400).send("<h1>400: PubmedID or both TF and TG must be provided!</h1>");
			return
		}
	}

	var collection = sentenceDB.metadata_genex;

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
	var term = req.query.term;
	var type = req.query.type;
	var limit = 20;
	
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
	var regexTerm = new RegExp('^'+term)
	
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
	var term = req.query.term;
	var type = req.query.type;
	var limit = 20;
	
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
	var regexTerm = new RegExp('^'+term.toLowerCase())
	
	var searchTerm = { $or: [{ lcLabel: regexTerm }, { synonyms: regexTerm }]}
	
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
	var term = req.query.term;
	var type = req.query.type;
	var limit = req.query.limit;
	
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
	var regexTerm = new RegExp(term, 'i');
	
	collection.find({prefLabel: { $regex: regexTerm }}).sort({ refScore : -1 }).limit(parseInt(limit), function (err, docs) {
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

