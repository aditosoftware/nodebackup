"use strict";

var sshComm = require('../misc/sshFunc');
var logger = require('../logger/Logger');
var helpf = require('../misc/helpFunc');

//create an array with all deploys of one or more namespaces
var getAllDeployOnKube = async function (server, backupConfig, backupServer, execServer) {
    var serverConf = helpf.getServerConfig(server, '', backupConfig); //get configuration of a kubernetes node
    var sshServerConfig = helpf.getSSHConf(server, '', backupConfig); //get ssh configuration of a kubernetes node
    var namespacesStr = serverConf.namespaces; //names of namespaces, where show for backupjobs. If not defined, show in all

    var allDeploys = []; //array to save deploys with backup annotations
    var getAllDeploys = "kubectl get deploy --all-namespaces -o json";
    var deploysArr = await sshComm.runUnderSSH(getAllDeploys, sshServerConfig.SSHKey, sshServerConfig, sshServerConfig, false); //get all deploys in cluster
    var parsedDeploy = JSON.parse(deploysArr); //convert string to a js object

    parsedDeploy.items.map((item) => {
        var backupChk = item.metadata.annotations.backup; //check if backup annotation is defined

        if (backupChk !== null && backupChk !== undefined) {
            if (namespacesStr !== undefined && namespacesStr !== null) {
                var nsparsed = JSON.parse(namespacesStr); //convert namespace config from config.yaml to a array
                var nameOfNs = item.metadata.namespace;
                if (nsparsed.indexOf(nameOfNs) > -1) {
                    delete item['status']
                    allDeploys.push(item);
                }
            } else {
                allDeploys.push(item);
            }
        }
    })

    //create Array of kube deploys object for backup
    if (allDeploys.length > 0) {

        var configArr = []; //

        for (var i = 0; i < allDeploys.length; i++) {
            var deploy = allDeploys[i];
            var annot = deploy.metadata.annotations;

            var arrDep = [];
            var prerun = [];
            var postrun = [];

            if (annot.prerun !== undefined && annot.prerun !== null) { //check preruns
                var prerun = annot.prerun;
            }

            if (annot.postrun !== undefined && annot.postrun !== null) { //check postruns
                var postrun = annot.postrun;
            }

            if (annot.strategy == "off") { //get type of backup (shutdown bevor backup or not)
                var deployName = deploy.metadata.name;
                var deployNs = deploy.metadata.namespace

                var deployDel = 'kubectl delete -n ' + deployNs + ' deploy ' + deployName + ' --grace-period=60';
                var deployCrt = "echo '" + JSON.stringify(deploy) + "' | kubectl create -n " + deployNs + " -f -";

            }

            //create Objec
            var serverConnObj = {
                'HOST': serverConf.HOST,
                'USER': serverConf.USER,
                'PORT': serverConf.PORT,
                'prerun': prerun,
                'postrun': postrun,
                'strategy': annot.strategy,
                'nextfullbackup': annot.nextfullbackup,
                'noffullbackup': annot.noffullbackup,
                'backup': annot.backup,
                'confprefixes': annot.confprefixes,
                'compression': annot.compression,
                'sftpServer': serverConf.sftpServer,
                'include': annot.include,
                'exclude': annot.exclude,
                'kube': 'true',
            }

            if (annot.passphrase !== undefined && annot.passphrase !== null) { //get passphrase for duplicity
                serverConnObj.passphrase = annot.passphrase
            }

            if (annot.name !== undefined && annot.name !== null) {
                serverConnObj.name = annot.name;
            } else {
                serverConnObj.name = deploy.metadata.name;
            }

            serverConnObj.failover = {};

            if (annot.startaftererror !== undefined && annot.startaftererror !== null) { //start the deploy again after error, default yes
                if (annot.startaftererror == "false") {
                    serverConnObj.startaftererror = false;
                } else {
                    serverConnObj.startaftererror = true;
                    serverConnObj.failover.run = true;
                    serverConnObj.failover.command = deployCrt;
                    serverConnObj.failover.server = server;
                }
            } else {
                serverConnObj.startaftererror = true;
                serverConnObj.failover.run = true;
                serverConnObj.failover.command = deployCrt;
                serverConnObj.failover.server = server;
            }

            if (annot.failovercustom !== undefined && annot.failovercustom !== null) { //custom command, if backup error
                serverConnObj.failover.run = true;
                serverConnObj.failover.command = annot.failovercustom;;
                serverConnObj.failover.server = server;
            }

            if (prerun !== undefined && prerun !== null) {
                serverConnObj.prerun = prerun;
            }

            if (postrun !== undefined && postrun !== null) {
                serverConnObj.postrun = postrun;
                if (annot.strategy == "off") {
                    prerun.unshift(deployDel);
                    postrun.push(deployCrt);
                }
            }

            configArr.push(serverConnObj);

        }
    }

    return new Promise((resolve, reject) => {
        return resolve(configArr);
    })
}

module.exports = {
    getAllDeployOnKube
}
