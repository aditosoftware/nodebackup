'use strict'

var ssh2 = require('ssh2');
var logger = require('../logger/Logger');
var fs = require('fs');

//function to run a ssh command, this command will be started from starter on server2 through server1
var runUnderSSH = async function (command, sshkey, server1, server2, doOutput) {
    var self = this;
    var fserConf = server1;
    var sserConf = server2;
    var output = "";
    var erroutput = "";
    return new Promise((resolve, reject) => {
        var conn1 = new ssh2;
        var conn2 = new ssh2;

        conn1.on('error', function (err) {
            conn1.end();
            return reject(err);
        });

        //start ssh connection from starter to server1
        conn1.on('ready', function () {
            logger.debug("Start connection to server: " + sserConf.HOST + ":" + sserConf.PORT + " through " + fserConf.HOST);
            conn1.exec("nc " + sserConf.HOST + " " + sserConf.PORT, function (err, stream) {
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

        //start ssh connection from server1 to server2
        conn2.on('ready', function () {
            logger.debug("Start connection to " + sserConf.HOST + " through " + fserConf.HOST);
            //logger.debug("Server: " + sserConf.HOST + ": " + command);

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

                    var borgRepoInit = /borg init -e repokey/gi;
                    var borgCreateRegEx = /borg create -C zlib --json/gi;
                    var borgPermDenied = /Permission denied/gi;
                    if (command.match(borgRepoInit)) {
                        // code = 0, if repo not exist; code=2 if repo exist
                        if (code !== 0 && code !==2) {
                            return reject("Connection through " + fserConf.HOST + " to " + sserConf.HOST + " ERR: " + erroutput);
                            logger.error("Error: on " + sserConf.HOST + " : " + erroutput);
                        }
                    } else if (command.match(borgCreateRegEx)) {
                        if (code !== 1 && code !== 0) {
                            return reject("Connection through " + fserConf.HOST + " to " + sserConf.HOST + " ERR: " + erroutput);
                            logger.error("Error: on " + sserConf.HOST + " : " + erroutput);
                        }
                    } else {
                        if (code !== 0) {
                            return reject("Connection through " + fserConf.HOST + " to " + sserConf.HOST + " ERR: " + erroutput);
                        }
                    }
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
                        logger.info("... ...command triggered: " + command );
                        logger.debug("Output command: " + data.toString());
                    }
                    output += data.toString();
                }).stderr.on('data', function (err) {
                    erroutput += err;
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
var deleteSSHKey = async function (eServer, sshkey, backupConfig, sshKeyName) {
    var self = this;
    var execServer = backupConfig.clientserver[eServer];

    return new Promise((resolve, reject) => {
        self.runUnderSSH('rm -Rf /tmp/' + sshKeyName, sshkey, execServer, execServer, false)
            .then((result) => {
                logger.debug("SSH key was delete from " + eServer);
                return resolve(result);
            }, (error) => {
                logger.error("Cannot delete ssh key from " + eServer);
                return reject(error);
            })
    })

}

//function to copy ssh key from starter to exec server, temporaly for a backupjob
var copySSHKey = async function (eServer, sshkey, backupConfig, sshKeyName) {
    var conn = new ssh2();
    var localpath = backupConfig.starter.sshkey;
    var remotepath = '/tmp/' + sshKeyName;
    var execServer = backupConfig.clientserver[eServer];

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
                        runUnderSSH("chmod 600 " + remotepath, sshkey, execServer, execServer)
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
            keepaliveInterval: 30000,
            readyTimeout: 15000,
        });
    })
}

module.exports = {
    runUnderSSH,
    deleteSSHKey,
    copySSHKey
}
