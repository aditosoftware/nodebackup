FROM node:10-alpine

ADD run.sh /
ADD BackupExecV3.js /nodebackup/
ADD lib /nodebackup/lib/
ADD package.json /nodebackup/package.json

RUN apk update && apk upgrade && \
    apk add --no-cache bash openssh ssmtp \
    && touch /crontab.tmp \
    && echo '2 0 * * * echo "Test Test"' >> /crontab.tmp \
    && crontab /crontab.tmp \
    && rm -rf /crontab.tmp \
    && cd /nodebackup && npm install && npm update\
    && chmod +x /run.sh

CMD ["/run.sh"]