'use strict'

var sshComm = require('./sshFunc');
var logger = require('./Logger');
var helpf = require('./helpFunc');

//return arrays of linked containers, where label "backup" is defined
var getAllContainerOnServer = async function (server, backupConfig, backupServer, execServer) {
    
    var clientConfig = helpf.getServerConfig(server, '', backupConfig);
    var execConfig = helpf.getServerConfig(execServer, '', backupConfig);
    var sshkey = backupConfig.SSHKey;
    var containerArrCommand = [];
    var getContainers = "echo -e \"GET /containers/json?all=1 HTTP/1.0\r\n\" | sudo nc -U /var/run/docker.sock"

    var dockerOutput = await sshComm.runUnderSSH(getContainers, sshkey, execConfig, clientConfig, false);

    var conInfo = dockerOutput.toString().split("\n");
    var httpCode = conInfo[0].replace('HTTP/1.0 ', '').slice(0, 3);

    if (httpCode === "200") {
        var containers = JSON.parse(conInfo[conInfo.length - 2]);
        var conOutArr = []
        for (var i = 0; i < containers.length; i++) {
            var dockerConObj = {};
            var runC = await containerProm(containers[i], server, backupServer, execServer, backupConfig);
            if (runC !== undefined) {
                conOutArr.push(runC);
            }
        }

        return new Promise((resolve) => {
            return resolve(conOutArr);
        })
    } else {
        console.log(httpCode);
    }
}

var containerProm = async function (container, server, backupServer, execServer, backupConfig) {
    
    var dockerHostConfig = helpf.getServerConfig(server, '', backupConfig);
    var execConfig = helpf.getServerConfig(execServer, '', backupConfig);
    var sshkey = backupConfig.SSHKey;

    var labels = container.Labels;

    if (labels.backup !== undefined && labels.backup !== null) {
        var slicedName = container.Names[0];
        var containerName = slicedName.slice(1, slicedName.length);
        var getContainerInfo = "echo -e \"GET /containers/" + containerName + "/json HTTP/1.0\r\n\" | sudo nc -U /var/run/docker.sock"

        var getLinksOfCon = await sshComm.runUnderSSH(getContainerInfo, sshkey, execConfig, dockerHostConfig, false);
        var conInfo = getLinksOfCon.toString().split("\n");
        var httpCode = conInfo[0].replace('HTTP/1.0 ', '').slice(0, 3);
        var containerObj = {};
        var containerArr = [];
        var commandArrContainer = [];
        var serverConnObj = {};

        if (httpCode === "200") {
            var conParsed = JSON.parse(conInfo[conInfo.length - 2]);
            var conLinksArr = conParsed.HostConfig.Links;
            var nameStr = conParsed.Name;
            var connName = nameStr.slice(1, nameStr.length);
            var containerObj = {
                'name': labels.name
            }

            if (conLinksArr !== undefined && conLinksArr !== null) {
                var tempnameArr = [];
                for (var x = 0; x < conLinksArr.length; x++) {
                    var link = conLinksArr[x];
                    var linkArr = link.split(":");
                    var name = linkArr[0].slice(1, linkArr[0].length);
                    tempnameArr.push(name);
                }

                containerArr = tempnameArr.reduce(function (a, b) {
                    if (a.indexOf(b) < 0) a.push(b);
                    return a;
                }, []);
                //containerArr.push(connName);
            } else {
            }
        } else {
            // logger.error("get container info error " + httpCode);
        }

        containerObj.links = containerArr;

        var containerCommArr = [];
        var prerun = [];
        var postrun = [];

        if (labels.prerun !== undefined) {
            var prerun = JSON.parse(labels.prerun);
        }
        if (labels.postrun !== undefined) {
            var postrun = JSON.parse(labels.postrun);
        }

        if (labels.strategy == "off") {
            var dockerstop = "sudo docker stop " + connName;
            var dockerstart = 'sudo docker start';
            var links = containerObj.links;
            if (links.length > 0) {
                for (var i = 0; i < links.length; i++) {
                    dockerstop += " " + links[i];
                    dockerstart += " " + links[i];
                }
            }
            prerun.unshift(dockerstop);
            dockerstart += " " + connName;
        }

        //create Objec
        var serverConnObj = {
            'HOST': dockerHostConfig.HOST,
            'USER': dockerHostConfig.USER,
            'PORT': dockerHostConfig.PORT,
            'prerun': prerun,
            'postrun': labels.postrun,
            'strategy': labels.strategy,
            'nextfullbackup': labels.nextfullbackup,
            'noffullbackup': labels.noffullbackup,
            'backup': labels.backup,
            'confprefixes': labels.confprefixes,
            'compression': labels.compression,
            'sftpServer': dockerHostConfig.sftpServer,
            'docker': 'true',
        }

        if (labels.passphrase !== undefined && labels.passphrase !== null) {
            serverConnObj.passphrase = labels.passphrase
        }

        serverConnObj.failover = {};

        if (labels.startaftererror !== undefined && labels.startaftererror !== null) {
            if (labels.startaftererror == "false") {
                serverConnObj.startaftererror = false;
            } else {
                serverConnObj.startaftererror = true;
                serverConnObj.failover.run = true;
                serverConnObj.failover.command = dockerstart;
                serverConnObj.failover.server = server;
            }
        } else {
            serverConnObj.startaftererror = true;
            serverConnObj.failover.run = true;
            serverConnObj.failover.command = dockerstart;
            serverConnObj.failover.server = server;
        }

        if (labels.failovercustom !== undefined && labels.failovercustom !== null) {
            serverConnObj.failover.run = true;
            serverConnObj.failover.command = labels.failovercustom;;
            serverConnObj.failover.server = server;
        }

        if (labels.name !== undefined && labels.name !== null) {
            serverConnObj.name = labels.name;
        } else {
            serverConnObj.name = connName;
        }

        if (prerun !== undefined && prerun !== null) {
            serverConnObj.prerun = prerun;
        }

        if (postrun !== undefined && postrun !== null) {
            serverConnObj.postrun = postrun;
            if (labels.strategy == "off") {
                postrun.push(dockerstart);
            }
        }

        // var connCom = await createBackupCommands(serverConnObj, server, 'true', backupConfig, backupServer);

        return new Promise((resolve, reject) => {
            return resolve(serverConnObj);
        })

    }
}

module.exports = {
    getAllContainerOnServer
}