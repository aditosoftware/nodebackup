'use strict'

//get ssh configuration of a server from config.yaml
var getSSHConf = function (serverName, type, serverConfig) {
    if (type == "backup") {
        var serverConfigLoc = serverConfig.backupserver[serverName];
    } else {
        var serverConfigLoc = serverConfig.clientserver[serverName];
    }

    var sshConfig = {
        'HOST': serverConfigLoc.HOST,
        'USER': serverConfigLoc.USER,
        'PORT': serverConfigLoc.PORT,
        'SSHKey': serverConfig.SSHKey
    }

    return sshConfig;
}

//get server configuration of a server from config.yaml
var getServerConfig = function (serverName, type, serverConfig) {
    if (type == "backup") {
        var serverConfig = serverConfig.backupserver[serverName];
    } else {
        var serverConfig = serverConfig.clientserver[serverName];
    }

    return serverConfig;
}

//check, that PORT,HOST and USER are defined in config.yaml
var checkConfig = function (config) {
    return new Promise((resolve, reject) => {
      _checkConfig(config[0], (err, result) => {
        if (err) {
          return reject(err);
        } else {
          _checkConfig(config[1], function (err, result) {
            if (err) {
              return reject(err);
            } else {
              return resolve(0);
            }
          })
        }
      })
    })
  }
  
  //function to check parameter PORT,USER,HOST of a server(client/server);
  function _checkConfig(serverConfig, callback) {
    if (!serverConfig.HOST) {
      return callback("HOST");
    }
    if (!serverConfig.USER) {
      return callback("USER");
    }
    if (!serverConfig.PORT) {
      return callback("PORT");
    }
    return callback(0);
  }

module.exports = {
    getSSHConf,
    getServerConfig,
    checkConfig
}