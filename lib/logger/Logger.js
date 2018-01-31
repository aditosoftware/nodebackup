'use strict'

var winston = require('winston');

var logger;

//set logging level
// -d debug in console
// -f debug output in the file
var setLevel = function (level, filepath) {
    logger = new (winston.Logger)({
        level: level,
        transports: [
            new (winston.transports.File)({
                filename: filepath,
                json: false
            })
        ]
    })

    if (level == 'debug') {
        logger.add(winston.transports.Console, {json: false});
    } else {
        if (level == 'debugfile') {
            logger = new (winston.Logger)({
                level: 'debug',
                transports: [
                    new (winston.transports.File)({
                        filename: filepath,
                        json: false
                    })
                ]
            });
        } else {
            //if error, write to console
            logger.add(winston.transports.Console, {
                level: 'error',
                json: false
            });
        }
    }
}

var debug = function (text) {
    logger.debug(text);
}

var info = function(text){
    logger.info(text);
}

var error = function(text){
    logger.error(text);
}

module.exports = {
    setLevel,
    error,
    debug,
    info
}