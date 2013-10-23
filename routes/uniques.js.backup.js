var pg = require('pg'),
url = require('url'),
loggly = require('loggly'),
ga = require('nodealytics'),
fs = require('fs'),
request = require('request'),
async = require('async'),
settings = require('../settings');

var conString = "postgres://" + settings.pg.username + ":" + settings.pg.password + "@" + settings.pg.server + ":" + settings.pg.port + "/" + settings.pg.database;

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

var parsedPlaces = [];
var queryResponse = [];

//Configure Loggly (logging API)
var config = {
	subdomain: settings.loggly.subdomain,
	auth: {
		username: settings.loggly.username,
		password: settings.loggly.password
	},
	json: true
};

//Loggly client
var logclient = loggly.createClient(config);

//Google Analytics
ga.initialize(settings.ga.key, 'webviz.redcross.org', function () {
});

exports.gdpcClavin = function(req,res) {
	var docs = req.body;
	var queryResponse = [];

	if (docs.length > 1) {
		res.end('Only submit one document at a time.');
	}

	var gdpcCommand = 'sudo cp '+ settings.filepath.filename + ' ' + settings.filepath.clavin + ' && cd ../CLAVIN && MAVEN_OPTS="-Xmx2048M" mvn exec:java -Dexec.mainClass="com.bericotech.clavin.gdpc"';
	var exec = require('child_process').exec;
	

	fs.writeFile(settings.filepath.filename, docs[0].text, function(err) {
		if(err) {
			log(err);
		} else {
			// log("The file " + docs[0].name + " was saved!");
		}
	});

	var parseClavin = function (clavin, callback) {
		async.waterfall([
			function(callback){
				var makePlacesResult;
				async.map(clavin, makePlaces, function(err, result) {
						makePlacesResult = result;
				});

				log(makePlacesResult);
				callback(null, makePlacesResult);
		    },
		    function(places, callback){
		    	var geoDBloc = [];
		    	var featureIDs = [];
		    	var counter = 1;

		    	for(i=0;i<places.length;i++) {
		    		searchterm = encodeURIComponent(places[i]);
		    		request.get('https://webviz.redcross.org/services/nameSearch?searchterm=' + searchterm + '&format=GeoJSON' + '&returnGeometry=no', function (error, response, body) {
						if (!error && response.statusCode == 200) {
							geoDBloc = JSON.parse(body);
							// log('geobloc ' + JSON.stringify(geoDBloc));
							
							if (geoDBloc.message) {
								// log('geobloc message' + geoDBloc);
								counter++;

								if (counter > places.length) {
									log('name lookup callback ');
									callback(null, featureIDs);
								}
							} else if (geoDBloc.source == 'Geonames') {
								//need to handle geonames
								//get lat,lng to pass to WKT for admin stack
								log('geoname hit - ' + geoDBloc.features[0].properties.name);
							} else {
								counter++;
								log('name counter is ' + counter);
								// log('this is the featureid ' + geoDBloc.features[0].properties.featureid);
								featureIDs.push(geoDBloc.features[0].properties.featureid);
								log('feature name - ' + geoDBloc.features[0].properties.name);
								// log('featureIDs \n' + JSON.stringify(featureIDs));

								if (counter > places.length) {
									log('name lookup callback ');
									callback(null, featureIDs);
								}
							}
							
						} else {
							// log(response.statusCode + ' - ' + response.headers);
							log('error - ' + error);
						}
					});
		    	}
		    	
		    },
		    function(places, callback){
		    	log('next function ' + places);
				
				var geoDBloc;
    			var adminStacks = [];
    			var counter = 1;

				for(var i=0;i<places.length;i++) {
		    		feature = encodeURIComponent(places[i]);
		    		
		    		request.get('https://webviz.redcross.org/services/getAdminStack?featureid=' + feature + '&format=GeoJSON', function (error, response, body) {
						if (!error && response.statusCode == 200) {
							geoDBloc = JSON.parse(body);
							// log('geobloc ' + JSON.stringify(geoDBloc));
							
							if (geoDBloc.message) {
								// log('geobloc message' + geoDBloc);
								counter++;
								log('stack counter is ' + counter);

								if (counter > places.length) {
									log('admin stack callback' + JSON.stringify(adminStacks));
									callback(null, adminStacks);
								}
							} else {
								counter++;
								log('this is the adm0_name ' + geoDBloc.features[0].properties.adm0_name);
								// for (var key in geoDBloc.features[0].properties) {
								// 	if (key.indexOf('name') != -1) {
								// 		log(key);
								// 		log(geoDBloc.features[0].properties.key);
								// 		adminStacks.push(geoDBloc.features[0].properties.key);
								// 	}
								// }

									for(i=0;i<6;i++){
										currentAdm = 'adm' + i + '_name';
										if (geoDBloc.features[0].properties[currentAdm]){
											if(adminStacks.indexOf(geoDBloc.features[0].properties[currentAdm]) == -1) { //only push uniques
												adminStacks.push(geoDBloc.features[0].properties[currentAdm]);
											}
										}

										log(JSON.stringify(geoDBloc.features[0].properties));
									}

								// log('adminStacks \n' + JSON.stringify(adminStacks));

								if (counter > places.length) {
									log('admin stack callback' + JSON.stringify(adminStacks));
									callback(null, adminStacks);
								}
							}
							
						} else {
							// log(response.statusCode + ' - ' + response.headers);
							log('error - ' + error);
						}
					});
		    	}

		    },
		    function(places, callback){
		    	var uniques = {};
		    	uniques.documentName = docs[0].name;
		    	uniques.date = new Date();
		    	uniques.resolvedLocations = [];
		  		for(i=0;i<places.length;i++){
		  			uniques.resolvedLocations.push(places[i]);
		  		}


		    	callback(null, uniques);
		    }
		], function (err, result) {
		   callback(result);  
		});
	}

	var myObj = {};

	myObj.list = function(callback){
		var result;
		exec(gdpcCommand, function (error, stdout, stderr) {
			callback(stdout);
		});
	}

	myObj.list(function (stdout) {
		var cS = stdout.indexOf('Resolved');
		var cE = stdout.indexOf('All Done')-3;
		var clavinRep = stdout.substring(cS,cE).split('#$#$');
		// clavinRep = clavinRep.split('#$#$');

		log(stdout);

		parseClavin(clavinRep, function(places) {
			res.jsonp(places);
		});
	});

}

//Utilities
function log(message) {
    //Write to console and to loggly
    logclient.log(settings.loggly.logglyKey, message);
    console.log(message);
}

function makePlaces(places, callback) {
		var pS = places.indexOf('as:') + 5;
		var pE = places.indexOf('{') - 2;
		
		places = places.substring(pS,pE);
		callback(null, places);
}

function geoWebNameLookup(searchterm, callback) {
	

    //Reach out to GeoWebServices API for featureID/stackID
    //Encode for URL
    searchterm = encodeURIComponent(searchterm);
    log('search term is ' + searchterm);
    var geoDBloc = [];
    request.get('https://webviz.redcross.org/services/nameSearch?searchterm=' + searchterm + '&format=GeoJSON' + '&returnGeometry=no', function (error, response, body) {
  		// log(body.data);
  		
  		if (!error && response.statusCode == 200) {
  			log(response.statusCode + ' - ' + JSON.stringify(response.headers));
    		geoDBloc.push(JSON.parse(body));
    		log('geobloc' + geoDBloc);
    		log('this is the first ' + geoDBloc[0].features[0].properties.featureid);
    		callback(body.features);
  		} else {
  			// log(response.statusCode + ' - ' + response.headers);
  			log('error - ' + error);
  		}
	});

};

function getAdminStack(feature, callback) {
	process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

	request({uri: 'https://webviz.redcross.org/services/getAdminStack?featureid=' + feature + '&format=GeoJSON', strictSSL: false}, function (error, response, body) {
  		if (!error && response.statusCode == 200) {
  			log(body);
  			callback(body);
  		}
	});
}