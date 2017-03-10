var ssh2 = require('ssh2');
var fs = require('fs');
var path = require('path');

var verifyBackup = function (config, server, exec, logger) {
  this.config = config;
  this.bserver = server;
  this.eserver = exec;
  this.logger = logger;

  //console.log(this.config.backupserver.backup2);

  if (path.isAbsolute(config.starter.sshkey)) {
    this.sshkeypath = config.starter.sshkey;
  } else {
    this.sshkeypath = path.resolve(path.dirname(process.argv[1]) + "/" + config.starter.sshkey);
  }
}; //construct;

verifyBackup.prototype.verifyAllBackups = function (callback) {
  var self = this;
  self.runSSH("ls /" + self.config.backupserver[self.bserver].backuppath, self.sshkeypath, self.eserver, self.bserver, function (err, data) {
    if (err) {
      self.logger.error(err);
    } else {
      var listOfFolders = data.toString().split("\n");
      listOfFolders.splice(-1, 1);
      for (var i = 0; i < listOfFolders.length; i++) {
        listOfFolders[i] = self.config.backupserver[self.bserver].backuppath + "/" + listOfFolders[i];
      }

      var tmpdir = listOfFolders.indexOf(self.config.backupserver[self.bserver].tmpdir);
      if (tmpdir > -1) {
        listOfFolders.splice(tmpdir, 1);
      }
      var archivdir = listOfFolders.indexOf(self.config.backupserver[self.bserver].duplicityarchiv);
      if (archivdir > -1) {
        listOfFolders.splice(archivdir, 1);
      }
      
      self.startVerifyBackup(listOfFolders).then(function (outArr) {
        return callback(null, outArr);
      }).catch(function (err) {
        return callback(err, null);
      });
    }
  });
};

verifyBackup.prototype.startVerifyBackup = function (folderList) {
  var self = this;

  return Promise.all(folderList.map(function (folder) {
    return self.checkFolder(folder);
  }));
};

verifyBackup.prototype.checkFolder = function (folder) {
  var self = this;
  return new Promise(function (resolve, reject) {
    if (self.config.backupserver[self.bserver].passphrase !== undefined && self.config.backupserver[self.bserver].passphrase !== null) {
      var passphrase = "PASSPHRASE=" + self.config.backupserver[self.bserver].passphrase;
    } else {
      var passphrase = "";
    }
    if (self.config.backupserver[self.bserver].tmpdir !== undefined && self.config.backupserver[self.bserver].tmpdir !== null) {
      var btemp = self.config.backupserver[self.bserver].tmpdir;
    } else {
      var btemp = "";
    }

    var command = "sudo " + passphrase + " duplicity verify file://" + folder + " " + btemp;
    self.runSSH(command, self.sshkeypath, self.eserver, self.bserver, function (err, data) {
      if (err) {
        return reject(err);
      } else {

        var output = data.toString().split("\n");
        output.splice(0, 2);
        var objReturn = {
          name: folder,
          output: output
        };
        return resolve(objReturn);
      }
    });
  });
};

verifyBackup.prototype.runSSH = function (command, sshfilepath, server1, server2, callback) {
  var self = this;
  var fserConf = self.config.clientserver[server1];
  var sserConf = self.config.clientserver[server2];
  var sshkey = fs.readFileSync(sshfilepath);
  var output = "";

  var conn1 = new ssh2;
  var conn2 = new ssh2;

  conn1.on('error', function (err) {
    conn1.end();
    return callback(err, null);
  });

  conn1.on('ready', function () {
    self.logger.debug("Start connection to exec: " + sserConf.HOST);
    conn1.exec("nc " + sserConf.HOST + " " + fserConf.PORT, function (err, stream) {
      if (err) {
        conn1.end();
        return callback(err, null);
      } else {
        stream.stderr.on('data', function (data) {
          self.logger.error("error on " + fserConf.HOST + ":" + data);
          return callback(data, null);
        });
      }
      conn2.connect({
        sock: stream,
        username: sserConf.USER,
        privateKey: sshkey
      });
    });
  });
  conn2.on('ready', function () {
    self.logger.debug("Start connection to " + sserConf.HOST + " through " + fserConf.HOST);
    self.logger.debug("Server: " + sserConf.HOST + ": " + command);
    conn2.exec(command, function (err, stream) {
      if (err) {
        self.logger.error("error on " + sserConf.HOST + ": command - " + command);
        stream.end();
        conn2.end();
        conn1.end();
        return callback(err, null);
      }
      stream.on('end', function () {
        stream.end();
        conn2.end();
        conn1.end(); // close parent (and this) connection 

        return callback(null, output);
      }).on('data', function (data) {
        self.logger.debug("Output command: " + command + ": " + data.toString());
        output += data.toString();
      }).stderr.on('data', function (err) {
        return callback("Connection through " + fserConf.HOST + " to " + sserConf.HOST + " ERR: " + err, null);
      });
    });
  });

  conn1.connect({
    host: fserConf.HOST,
    port: fserConf.PORT,
    username: fserConf.USER,
    privateKey: sshkey
  });

};

verifyBackup.prototype.scpCopyFile = function (sshfilepath, server, localpath, remotepath, callback) {
  var self = this;
  var serConf = self.config.backupserver[server];
  var conn = new ssh2();

  conn.on('error', function (err) {
    conn.end();
    return callback(err, null);
  });
  conn.on('ready', function () {
    conn.sftp(function (err, sftp) {
      if (err) {
        return callback(err, null);
      } else {
        var readStream = fs.createReadStream(localpath);
        var writeStream = sftp.createWriteStream(remotepath);

        writeStream.on('close', function () {
          sftp.end();
          conn.end();
          return callback(null, "transfer successfull");
        });
        readStream.pipe(writeStream);
      }
    });
  });
  conn.connect({
    host: serConf.HOST,
    port: serConf.PORT,
    username: serConf.USER,
    privateKey: fs.readFileSync(sshfilepath)
  });
};

verifyBackup.prototype.writeOutput = function (results) {
  var self = this;
  var textOutput = [];

  results.map(function (backup) {
    textOutput.push({
      Backup: backup.name,
      Status: backup.output
    });
  });
  require('console.table');
  console.table(textOutput);
};

module.exports = verifyBackup;