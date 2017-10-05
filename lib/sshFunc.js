'use strict'

var ssh2    = require('ssh2');
var logger  = require('./Logger');
var fs      = require('fs');


var runUnderSSH = async function (command, sshkey, server1, server2, doOutput) {
    var self        = this;
    var fserConf    = server1;
    var sserConf    = server2;
    var output      = "";
    return new Promise((resolve, reject) => {
        var conn1   = new ssh2;
        var conn2   = new ssh2;

        conn1.on('error', function (err) {
            conn1.end();
            return reject(err);
        });

        conn1.on('ready', function () {
            logger.debug("Start connection to exec: " + sserConf.HOST);
            conn1.exec("nc " + sserConf.HOST + " " + fserConf.PORT, function (err, stream) {
                if (err) {
                    conn1.end();
                    return reject(err);
                } else {
                    stream.stderr.on('data', function (data) {
                        logger.error("error on " + fserConf.HOST + ":" + data);
                        conn1.end();
                        return reject("" + data);
                    });
                }
                conn2.connect({
                    sock: stream,
                    username: sserConf.USER,
                    privateKey: sshkey,
                    readyTimeout: 15000,
                    keepaliveInterval: 10000
                });
            });
        });

        conn2.on('ready', function () {
            logger.debug("Start connection to " + sserConf.HOST + " through " + fserConf.HOST);
            logger.debug("Server: " + sserConf.HOST + ": " + command);
            conn2.exec(command, function (err, stream) {
                if (err) {
                    logger.error("error on " + sserConf.HOST + ": command - " + command);
                    stream.end();
                    conn2.end();
                    conn1.end();
                    return reject(err);
                }
                stream.on('close', function (code, signal) {
                    logger.debug('Command ' + command + ' run code: ' + code);
                });
                stream.on('end', function () {
                    stream.end();
                    conn2.end();
                    conn1.end(); // close parent (and this) connection 
                    
                    return resolve(output);
                }).on('data', function (data) {
                    if (doOutput === false) {
                        logger.debug("Output command: " + command + ": output ok");
                    } else {
                        logger.debug("Output command: " + command + ": " + data.toString());
                    }
                    output += data.toString();
                }).stderr.on('data', function (err) {
                    console.log("############## ERR ############## " + err);
                    return reject("Connection through " + fserConf.HOST + " to " + sserConf.HOST + " ERR: " + err);
                });
            });
        });

        conn1.connect({
            host: fserConf.HOST,
            port: fserConf.PORT,
            username: fserConf.USER,
            privateKey: sshkey,
            readyTimeout: 15000,
            keepaliveInterval: 10000
        });
    });
}

//function to delete sshkey after backupjob was finished
var deleteSSHKey = function () {
    var self        = this;
    var execServer  = self.bConfig.clientserver[self.eServer];
    var runOnServer = execServer;

    return new Promise((resolve, reject) => {
        self.runUnderSSH('rm -Rf /tmp/id', self.sshkey, execServer, runOnServer)
            .then((result) => {
                logger.debug("SSH key was delete from " + self.eServer);
                return resolve(result);
            }, (error) => {
                logger.error("Cannot delete ssh key from " + self.eServer);
                return reject(error);
            })
    })

}

//function to copy ssh key from starter to exec server, temporaly for a backupjob
var copySSHKey = async function (eServer, sshkey, backupConfig) {
    var conn        = new ssh2();
    var localpath   = backupConfig.starter.sshkey;
    var remotepath  = "/tmp/id";
    var execServer  = backupConfig.clientserver[eServer];

    return new Promise((resolve, reject) => {
        conn.on('error', function (err) {
            conn.end();
            logger.debug("SSH Key: " + localpath);
            logger.debug("PORT: " + execServer.PORT);
            return reject("Copy ssh key failed: " + err);
        });

        conn.on('ready', function () {
            conn.sftp(function (err, sftp) {
                if (err) {
                    return reject(err);
                } else {
                    var readStream = fs.createReadStream(localpath);
                    var writeStream = sftp.createWriteStream(remotepath);

                    writeStream.on('close', function () {
                        sftp.end();
                        conn.end();
                        logger.debug("SSH Key was copy to " + eServer);
                        runUnderSSH("chmod 600 /tmp/id", sshkey, execServer, execServer)
                            .then((result) => {
                                logger.debug('Copy of ssh key was successfull');
                                return resolve("Copy of ssh key was successfull");
                            }, (err) => {
                                logger.error('cannot set sshkey permissions: ' + err);
                                return reject("cannot set sshkey permissions " + err);
                            })
                    });
                    readStream.pipe(writeStream);
                }
            });
        });
        conn.connect({
            host: execServer.HOST,
            port: execServer.PORT,
            username: execServer.USER,
            privateKey: sshkey,
            keepaliveInterval: 30000
        });
    })
}

module.exports = {
    runUnderSSH,
    deleteSSHKey,
    copySSHKey
}