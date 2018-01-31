# Nodebackup

Nodebackup is a program written in Node.js.
This program can save the data of a server (folder), docker container volumes and also kubernetes deploy volumes (you need to define the annotations)

##### New 
Also we've added support of monitoring ([icinga2](https://icinga2.com)), the nodebackup can send his state of backups to the monitoring throught icinga2 api.

We use for backup the [duplicity](http://duplicity.nongnu.org) or [borg](https://borgbackup.readthedocs.io/en/stable/)

## Docker container

We've build a docker container with nodebackup [here](https://hub.docker.com/r/adito/nodebackup/)

You need only to mount the id_rsa(ssh private key), crontab.tmp and config.yaml
Show the example for docker-compose (docker-compose.yaml)

## Description
We have three differen type of server:
1. Server - normalserver
2. Docker Host - dockerhost
3. Kubernetes deploy (this is the same, as the docker host)

### Schema
1. Starter,exec,server,client are different server

a. Starter started Nodebackup on exec.\
b. Exec started a backupjob, defined in config.yml \
c. The backupdate will be transferd through exec server

 ![schema1](schema/starter-exec-client-server.png)


2. Starter, exex/client, server exec and client are the same server.
 
a. Starter started Nodebackup on exec.\
b. exec startet backupjob on the same server

 ![schema2](schema/starter-exec-server.png)

## Requiments
### Node.js

Install Node.js, you need version 7 or higher (with support of async/await)\
Install npm packages from packages.json
Run

    npm i

### Backup tools
You need install a backup tool, that you will use, we recommendate borg.

#### Duplicity 

You need to install [duplicity](http://duplicity.nongnu.org) on exec

#### Borg

You need the Borg verion > 1.1 - show the [releases](https://github.com/borgbackup/borg/releases) on Github

### SSHFS

Install this on exec server

### CIFS

Install cifs, if you'll backup a samba share (for example windows share)

### Firewall

Open SSH Port between exec<->target, exec<->client. You can define another ssh port (default 22). The ssh port is defined in config file for each server

### SSH Key

Authentification between starter, exec, target, client used ssh key. SSH key path is defined in config (starter/sshkey)

If the key not exist run on starter

    ssh-keygen
    ssh-copy-id {username}@exec
    ssh-copy-id {username}@target
    ssh-copy-id {username}@client
    
Now you can use this key for authentification. Add path of ssh key to config

Nodebackup will be copy this key to exec server, when backup job is completed key will be deleted.

## Configuration file

You need to save the **config.yml** in the same folder as nodebackup. Config.yml is a file in YAML format, where saved the information for backups, like backup address, port and user. \
Show example: **config_example.yaml**

### Starter configuration

Starter
    
    starter:
        sshkey: id_rsa 
        log:
          path: /var/log/backupexecv2
        pids: /var/run/nodebackup

**sshkey** - path to ssh key \
**log** - path to folder of log files \
**pids** - the running backupjob create a pid file, if a pidfile exist, then an backupjob cannot start \
**disableOutput** - disable table output, when backup is ready

### Backupserver configuration

Backup Server (Server, which save the backup)

    backupserver:
      backup2:
        passphrase: LkalmflkAJMAlkjfslk
        HOST: backup2.domain.local
        USER: admin2
        PORT: '22'
        backuppath: /a/target
        backupfor: '["freepbx", "superdocker"]'
        backuppartsize: 200
        tmpdir: /tmp
        prerun: '["echo backupserver_prerun1", "echo backupserver_prerun1"]'
        postrun: '["echo backupserver_postrun1", "echo backupserver_postrun1"]'
        provider: borg
        borgcache: /backup/borg
        borgcompression: zlib

        
**backup2** - name of the server. You can define more the on backup server \
**HOST** - DNS name of server. IP address is possible \
**USER** - user for authentification \
**PORT** - ssh port \
**passphrase** - this option enabled the encryption (borg and duplicity)\
**backuppartsize** (optional, **duplicity**) - size of backup archiv parts. If not defined, set to default (100mb) \
**backuppath** - path where the nodebackup will be save backups. Example: /a/target/clientname/path-from-clientconfig-backup \
**backupfor** - server from config/clientserver \
**prerun** - a command to run befor start backup. You can run a script, that is saved on target server \
**postrun** - a command to run after backup. \
**tmpdir** - folder for temporary files of duplicity (only a backuppart) \
**provider** - backup tool borg or duplicity \
**borgcache** (optional, **borg**) - path of borg cache folder. \
**borgcompression** (optional, **borg**) - possible settings - none(default), lz4 (super fast, low compression), zlib (medium speed and compression) or lzma (low speed, high compression). 

### Client Server (Server)

Client server

    clientserver: 
      freepbx:
        HOST: sip.example.com
        USER: root
        PORT: '22'
        nextfullbackup: 1m
        noffullbackup: 2
        keepbackup: 60
        backup: /var/spool/asterisk/backup/daily
        prerun: '["echo prerun1","echo prerun2"]'
        postrun: '["echo postrun1", "echo postrun2"]'
        confprefixes: '["asynchronous-upload"]'
        compression: "true/false"
        passphrase: "lasdkfasdf0)!=LfkajsdfL"
        sftpServer:
          sudo: true
          path: /usr/lib/sftp-server  
            
**freepbx** - alias of the server \
**HOST** - DNS name of server. IP address is possible \
**USER** - user for authentification \
**PORT** - ssh port \
**noffullbackup**(optional, **duplicity**) - number of fullbackups on server. Equivalent to duplicity "duplicity remove-all-but-n-full" \
**nextfullbackup**(optional, **duplicity**) - age of a fullbackup.Equivalent to duplicity "full-if-older-than" \
**prerun** - a command to run befor start backup. You can run a script, that is saved on target server \
**postrun** - a command to run after backup. \
**confprefixes** (optional, **duplicity**) - add paramater for rdiff-backup, more information in man rdiff-backup. You don't need to write "--" \
**sftpServer** - if you will use sudo on client, you need to define where is sfpt-server (use command "whereis sftp-server") \
**compression** (optional, **duplicity**) - default true \
**passphrase** - duplicity passphrase, can now for each server or container defined \
**keepbackup**(optional, **borg**) - delete all backups older then 60 days, equal "borg prune --keep-daily"


### Client Server (Dockerhost)

Docker Host configuration in **config.yaml** file

    clientserver:
      superdocker:
        docker: "true"
        HOST: superdocker.domain.local
        USER: docker
        PORT: '22'

Kubernetes configuration in **config.yaml** file

    heku1:
        HOST: k8s-node1.example.com
        USER: root
        PORT: 22
        kube: true
        namespaces: '["fortesting"]'

**namespaces**(optional) - if defined, the nodebackup will be show only this one namespace, it not defined, then nodebackup will be check all namespaces in k8s cluster. \

**IMPORTANT** you need to install the kubectl on server, the backupjob used this tool to delete and creat the k8s deploys.

#### docker-compose.yml example

    httpd:
      image: httpd
      hostname: backup-new-test-2
      volumes:
        - /a/data/backup-new-test-2/httpdocs:/a/http
        - /a/data/backup-new-test-2/httpconf:/a/conf
      restart: always
      labels:
        backup: /a/data/backup-new-test-2
        prerun: '["touch /tmp/id2.test", "echo test >> /tmp/id2.test"]'
        postrun: '["cat /tmp/id2.test", "rm /tmp/id2.test"]'
        strategy: 'off'
        include: '[ "/a/data/backup-new-test-2/inc1", "/a/data/backup-new-test-2/inc2", "/a/data/backup-new-test-2/inc3" ]'
        exclude: '[ "/a/data/backup-new-test-2/ex1", "/a/data/backup-new-test-2/ex2", "/a/data/backup-new-test-2/ex3" ]'
        compression: "false"
        startaftererror: "false"
        failovercustom: "echo test"
        passphrase: "lasdkfasdf0)!=LfkajsdfL"
        name: backup-new-test
        
        
#### Samba Share
    
    SMB:
      SET: "true"
      PATH: "d$"
      PASS: "AD User Pass"
      DOMAIN: "example.local"

#### kubernetes deploy (show example "echoserver-dep.yaml)

    
    nextfullbackup: "1W"
    noffullbackup: "2"
    backup: "/cephfs/derby"
    strategy: "off"
    passphrase: "containerPASS"

**name**(optional) - name of container in backup, if not defined then the backupjob will be use the name of container. 
**SMB** - Samba Config \
**PATH**  - Path on server (like \\server\d$) \
**PASS** - AD User Pass \
**DOMAIN** - AD Domain \
**include/exclude** - includes and excludes can used for files (if providers borg) or folders (both provider)
**strategy: off** - container/s or deploy will be shutdown befor backup (docker-compose -f /path/docker-compose.yml stop) and start again after backup \
**strategy: on** - backup will be run without shutdown the container or kubernetes deploy \
**startaftererror** - start container after error (prerun,postrun,backup). Default true \
**passphrase** - duplicity passphrase, can now for each server or container defined \
**failovercustom** - if container commands prerun,backup,postrun run in a error, then you can define a failovercustom command, the normal command is "sudo docker start CONTAINERNAME" \

other option are equivalent to clientserver configuration

#### Prerun and postrun will be run on docker host not in container, if you will run a command in conainer you can use "docker exec": 

    prerun: '["sudo docker-run exec -it containername command"]'

## Usage

    #:/nodejs/nodebackup$ node BackupExecV2.js -h

  Options:

    -h, --help             output usage information
    -V, --version          output the version number
    -b, --backup           start backup
    -e, --exec [exec]      server, which start backup job
    -t, --target [target]  single server for backup
    -s, --server [server]  backup server
    -d, --debug            debug to console
    -f, --debugfile        debug to file


### Example 
    
    node BackupExecV2 -b -e backup2 -s backup2
    
I've used here backup2 as exec and target server

### Backup of a single server 
With "-t name" can you make a single backup

    node BackupExecV2 -b -e backup2 -s backup2 -t freepbx
    
#### Single backup of a docker container or kubernetes deploy

    node BackupExecV2 -b -e backup2 -s backup2 -t backup-new-test

### Monitoring settings
The backup job can send, the state of backup on icinga2. You don't need create the host and services for this on icinga2 server, this will be create automatically from nodebackup. \
![schema2](schema/icinga_screenshot.png)
The backup server (server where the backups will'be saved) are registred as a host and for each backupjob, that was saved on backup server, was created a service with state of backup. \
The screenshot show us, that the backup server "backup2" have running two backupjobs - one is okay, the other one is with error (prerun command was not found). \

#### Configuration
We need this for working with monitoring.
1. Create a template for icinga2, that will be used from nodebackup. Show the file "backup-host.conf"
2. Added api user in icinga2. You can use our [icinga2 docker image](https://hub.docker.com/r/adito/icinga2/)
3. Added the settings for icinga2 in config.yaml configuration. Show the example configuration "config_example.yaml"
```
starter:
  sshkey: id_rsa
  log:
    path: log
  pids: pids
  # disableOutput: 'true'
  monitoring: 'true'
  hosttemplate: 'backup-host'
  srvtemplate: 'backup-service'
  monserver: '192.168.42.41'
  monport: '5665'
  monapiuser: 'root'
  monapipass: 'PASS'
  hostgroup: 'adito'
  servicegroup: 'adito'
```


### Output
#### Duplicity

|Name   |StartTime   |ElapsedTime   |Increment Files Size   |Total Size changed |Errors |Backup Type |
|---|---|---|---|---|---|---|
|superdocker/backup-new-test   |Thu Nov  2 15:35:10 2017   |6.48 (6.48 seconds)   |153586372 (146 MB)   |151442655 (144 MB)   |0   |duplicity   |

#### Borg
|Name   |StartTime   |Endtime   |Compressed Size   |Changed Files Size |Original Size |Backup Type |
|---|---|---|---|---|---|---|
|superdocker/backup-new-test   |2017-11-02T15:30:03.000000  |2017-11-02T15:30:11.000000   |75.419186 MB   |75.419186 MB   |153.592301 MB   |Borg   |