"use strict";

var sshComm = require('./sshFunc');
var logger = require('./Logger');
var helpf = require('./helpFunc');

var getAllDeployOnKube = async function (server, backupConfig, backupServer, execServer) {
    var serverConf = helpf.getServerConfig(server, '', backupConfig);
    var sshServerConfig = helpf.getSSHConf(server, '', backupConfig);
    var namespacesStr = serverConf.namespaces; //names of namespaces, where show for backupjobs. If not defined, show in all

    var allDeploys = []; //array to save deploys with backup annotations
    var getAllDeploys = "kubectl get deploy --all-namespaces -o json";
    var deploysArr = await sshComm.runUnderSSH(getAllDeploys, sshServerConfig.SSHKey, sshServerConfig, sshServerConfig, false); //get all deploys in cluster
    var parsedDeploy = JSON.parse(deploysArr);

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

            if (annot.prerun !== undefined && annot.prerun !== null) {
                var prerun = annot.prerun;
            }

            if (annot.postrun !== undefined && annot.postrun !== null) {
                var postrun = annot.postrun;
            }

            if (annot.strategy == "off") {
                var deployName = deploy.metadata.name;
                var deployNs = deploy.metadata.namespace

                var deployDel = 'kubectl delete -n ' + deployNs + ' deploy ' + deployName;
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
                'kube': 'true',
            }

            if (annot.passphrase !== undefined && annot.passphrase !== null) {
                serverConnObj.passphrase = annot.passphrase
            }

            if (annot.name !== undefined && annot.name !== null) {
                serverConnObj.name = annot.name;
            } else {
                serverConnObj.name = deploy.metadata.name;
            }

            serverConnObj.failover = {};

            if (annot.startaftererror !== undefined && annot.startaftererror !== null) {
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

            if (annot.failovercustom !== undefined && annot.failovercustom !== null) {
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
                    console.log(typeof prerun);
                    prerun.unshift(deployDel);
                    postrun.push(deployCrt);
                }
            }

            configArr.push(serverConnObj);

        }
    }

    // var test = JSON.stringify(allDeploys[1]);
    // console.log(allDeploys[1].metadata.name);

    // var delCOmm = 'kubectl delete -n fortesting deploy ' + allDeploys[1].metadata.name;
    // // console.log(delCOmm);
    // var ot1 = await sshComm.runUnderSSH(delCOmm, sshServerConfig.SSHKey, sshServerConfig, sshServerConfig); //get all deploys in cluster
    // console.log(ot1);

    // var createComm = "echo '" + test + "' | kubectl create -n fortesting -f -";
    // console.log(createComm);
    // var ot2 = await sshComm.runUnderSSH(createComm, sshServerConfig.SSHKey, sshServerConfig, sshServerConfig); //get all deploys in cluster
    // console.log(ot2);

    return new Promise((resolve, reject) => {
        return resolve(configArr);
    })
}

module.exports = {
    getAllDeployOnKube
}