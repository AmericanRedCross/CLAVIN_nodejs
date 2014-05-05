var express = require('express'),
    uniques = require('./routes/uniques');
 
var app = express();

app.use(express.bodyParser());
app.enable("jsonp callback");
app.post('/geodoc/', uniques.gdpcClavin);

app.listen(3000);
console.log('Listening on port 3000...');